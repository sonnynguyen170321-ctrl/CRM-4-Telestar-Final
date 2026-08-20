import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { runChatTurn, userMessageForFailure, type ChatTurnOutcome } from '@/lib/ai/chatRuntime';
import { isKnownModelId, type ModelId } from '@/lib/ai/models';
import { loadAuthorizedLeadContext } from '@/lib/leads/context';
import { calculateDeterministicSdrMetrics } from '@/lib/ai/contextEngine';
import { formatEodForPrompt, isEodRequest, loadEodSummary } from '@/lib/briefing/service';
import { isValidExecutionId, newExecutionId } from '@/lib/ai/executionId';
import { retrieveRelevantSkills } from '@/lib/ai/skill-retriever';
import { compileConstitutionalPrompt } from '@/lib/ai/behavior/telestar-ai-constitution';

/**
 * Telestar AI chat.
 *
 * Provider selection, failover, budget and attribution belong to `lib/ai/gateway.ts`; the tool
 * loop and its authorization belong to `lib/ai/chatRuntime.ts`. This route owns HTTP: who is
 * asking, whether the request is well formed, what CRM context the turn gets, and what the SDR
 * reads when something goes wrong.
 *
 * This file used to call a second provider runtime that picked its own model. That model was
 * withdrawn by Groq, the 404 was not a fallback condition, and every message in production
 * came back as "Sorry, I ran into a problem generating that." — with nothing in the logs to
 * tie the sentence to a cause. Hence `turnId`, and hence the classification in
 * `userMessageForFailure`.
 */

// A turn's history is bounded so a hostile or looping client cannot push an unbounded prompt
// through the provider on the tenant's budget.
const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 16_000;
const MAX_TOTAL_CHARS = 120_000;

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

/**
 * The browser supplies navigation hints. It supplies nothing the model reasons *from*.
 *
 * This schema used to accept `userName`, `userRole` and four performance counters, and it
 * ended in `.passthrough()` — three lines below a comment claiming unknown keys were
 * `.strip()`ped. Both halves were wrong in the same direction:
 *
 *   - `.passthrough()` let a client attach arbitrary extra keys to the context object, and
 *     anything reaching the system prompt through it is prompt text nobody reviewed. Zod's
 *     default object behaviour is exactly the `.strip()` the comment promised, so the fix is
 *     to stop overriding it.
 *   - The counters were client-authored numbers presented to the model as CRM truth. An SDR
 *     with dev tools could tell Telestar AI they had zero overdue tasks, and the answer —
 *     including anything a manager later read — would be built on it.
 *
 * What remains is `page` and `leadId`: where the user is, and which record is open. Neither
 * grants anything. `page` is a UI hint used to guess a channel; `leadId` is a *request* that
 * `loadAuthorizedLeadContext` then approves or refuses against the session. Identity, role,
 * tenant and every counter are read server-side from the CRM.
 */
const chatContextSchema = z.object({
  page: z.string().max(200).optional(),
  leadId: z.string().max(64).optional(),
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(MAX_MESSAGES),
  modelId: z.string().max(64).optional(),
  context: chatContextSchema.optional(),
  executionId: z.string().max(200).optional(),
});

/**
 * Bound the shape of a client-supplied lead id.
 *
 * This is not an authorization check and must never be mistaken for one — `loadAuthorizedLeadContext`
 * is what decides whether this user may see this lead. What this prevents is arbitrary client
 * text reaching the `AiCall.leadId` column, so the constraint that matters is the character
 * set and the length, not a particular id format.
 *
 * It used to be `^[a-z0-9]{20,32}$`, which is cuid v1 and nothing else. A UUID has hyphens; so
 * does any readable id. Such a lead's context was dropped in silence — the SDR had the
 * prospect open, asked about them, and the assistant answered that it could not see one.
 */
const LEAD_ID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

function sanitizeLeadId(value: unknown): string | undefined {
  return typeof value === 'string' && LEAD_ID_SHAPE.test(value) ? value : undefined;
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // One id per request, distinct from the execution id: the execution id is stable across
  // retries of the same logical turn (that is the point of it), so it cannot identify the
  // individual attempt that failed.
  const turnId = newExecutionId();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    // A malformed request is the client's problem and must never be reported as an AI failure —
    // conflating the two is how a validation bug hides behind "the AI is down".
    return NextResponse.json(
      { error: 'invalid chat request', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 },
    );
  }

  const { messages, context, executionId: clientExecutionId } = parsed.data;

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return NextResponse.json({ error: 'conversation is too long — start a new chat' }, { status: 413 });
  }

  // An unrecognised model id is not a reason to refuse the turn — a stale client, or a saved
  // preference for a model that has since been retired, should keep working. Falling back to
  // the router is the behaviour; silently honouring an unknown id is not.
  const preferredModel: ModelId | undefined = isKnownModelId(parsed.data.modelId)
    ? parsed.data.modelId
    : undefined;

  // Fetch user memories (server-side, always uses session userId)
  const memories = await prisma.aiMemory.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { memory: true },
  });

  const memoryBlock = memories.length > 0
    ? `\n\n[What I remember about ${user.firstName}]\n${memories.map((m) => `- ${m.memory}`).join('\n')}`
    : '';

  // Build live context block.
  //
  // `page` is the only client-supplied line here. Every number below it is read from the CRM
  // under this session's tenant and this session's user id, because a counter the browser
  // sent is a counter the browser chose.
  const contextLines: string[] = [];
  if (context?.page) contextLines.push(`Current page: ${context.page}`);

  const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content || '';

  const workload = user.tenantId
    ? await calculateDeterministicSdrMetrics(user.tenantId, user.id).catch(() => null)
    : null;
  if (workload) {
    contextLines.push(`Assigned leads: ${workload.assignedLeadsCount}`);
    contextLines.push(`Overdue tasks: ${workload.overdueTasksCount}`);
    contextLines.push(`Leads awaiting a reply follow-up: ${workload.hotRepliesCount}`);
    contextLines.push(`Meetings booked this month: ${workload.meetingsBookedThisMonth}`);
  }

  // End-of-day intent is detected and answered server-side.
  //
  // The chatbox used to fetch `/api/ai/briefing?type=eod` itself and attach the JSON to the
  // request as `context.eodData`. `.passthrough()` accepted the key and the system prompt
  // never read it, so the model answered "summarise my day" from conversation history while
  // a full round trip's worth of real figures sat unused in the request body.
  if (isEodRequest(lastUserMessage)) {
    const eod = await loadEodSummary(user).catch(() => null);
    if (eod) contextLines.push(`\n${formatEodForPrompt(eod)}`);
  }

  let playbookVersionId: string | undefined = undefined;

  const validLeadId = sanitizeLeadId(context?.leadId);
  if (validLeadId) {
    const leadContext = await loadAuthorizedLeadContext(user, validLeadId);
    if (leadContext) {
      contextLines.push(`\nCurrent lead: ${leadContext.leadName}`);
      if (leadContext.leadCompany) contextLines.push(`Company: ${leadContext.leadCompany}`);
      if (leadContext.leadStage) contextLines.push(`Pipeline stage: ${leadContext.leadStage}`);
      if (leadContext.leadDaysSinceContact != null) contextLines.push(`Days since last contact: ${leadContext.leadDaysSinceContact}`);
      if (leadContext.campaignName) contextLines.push(`Campaign: ${leadContext.campaignName}`);
      if (leadContext.clientName) contextLines.push(`Client: ${leadContext.clientName}`);

      if (leadContext.playbookVersionId) {
        playbookVersionId = leadContext.playbookVersionId;
      }
    }
  }

  const contextBlock = contextLines.length > 0
    ? `\n\n[Live CRM context]\n${contextLines.join('\n')}`
    : '';

  const inferredChannel = context?.page?.includes('phone') || context?.page?.includes('dialer')
    ? 'phone'
    : context?.page?.includes('whatsapp')
    ? 'whatsapp'
    : context?.page?.includes('linkedin')
    ? 'linkedin'
    : 'email';

  // Role and surface are weak tie-breakers, not authority: they nudge which craft module is
  // retrieved, never what the user may see. Both come from the session and the validated
  // navigation hint, never from anything the browser asserts about itself.
  const relevantSkills = retrieveRelevantSkills({
    channel: inferredChannel,
    operation: 'chat',
    topicText: lastUserMessage,
    role: user.role,
    surface: context?.page,
  });

  // The constitution is the first layer, and deliberately so.
  //
  // It encodes the authority ordering — security, then tenancy and RBAC, then CRM facts,
  // before anything about tone or usefulness — and it had been reaching no prompt at all:
  // nothing outside its own test imported it, so the priority ladder governed nothing a model
  // ever saw. Retrieved skills and style guidance sit below it, which is the point: generic
  // coaching can never outrank campaign policy or authorization.
  const systemPrompt = `${compileConstitutionalPrompt()}

You are the AI SDR Assistant for ${user.firstName} ${user.lastName} (${user.role} at Telestar).
Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.${memoryBlock}${contextBlock}

${relevantSkills}

IMPORTANT REMINDERS:
- Always address the SDR by their first name: ${user.firstName}
- Never make calls, send emails, or complete tasks autonomously — you coach humans who take the actions
- When you learn something important the SDR tells you, say "I'll remember that" and they can confirm
- Role-based note: ${user.role === 'sdr' || user.role === 'leadgen' ? 'This SDR sees only their own leads and tasks.' : `This user has ${user.role} access and can see team-level data.`}`;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = runChatTurn(
          {
            sessionUser: user,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            systemPrompt,
            preferredModel,
            leadId: validLeadId,
            playbookVersionId,
            // Never invented server-side. A generated id would be unique per request, which is
            // precisely what idempotency must not be: a retry would get a fresh namespace and
            // write a second CRM row. Absent or malformed means write-capable tools are
            // refused for this turn — see `runChatTurn`.
            executionId: isValidExecutionId(clientExecutionId) ? clientExecutionId : undefined,
            turnId,
          },
          (outcome) => logTurn(user, turnId, outcome, Date.now() - startedAt),
        );

        for await (const chunk of generator) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        // `runChatTurn` handles provider failure itself, so reaching here means something
        // structural broke — a database read for context, a tool service, a bug. The SDR still
        // gets a sentence rather than a truncated stream, and the turn id makes it findable.
        console.error(
          '[ai/chat] turn failed',
          JSON.stringify({
            turnId,
            tenantId: user.tenantId,
            userId: user.id,
            role: user.role,
            latencyMs: Date.now() - startedAt,
            error: err instanceof Error ? err.name : 'unknown',
          }),
        );
        controller.enqueue(encoder.encode(userMessageForFailure('unknown')));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      // Echoed so a support conversation can start from the id the browser already has.
      'X-Telestar-Turn-Id': turnId,
    },
  });
}

/**
 * One structured line per turn.
 *
 * Carries no prompt, no completion, no memory content and no credential — the ids and the
 * classification are what make a recurrence diagnosable, and they are all this needs.
 */
function logTurn(user: SessionUser, turnId: string, outcome: ChatTurnOutcome, latencyMs: number): void {
  const line = JSON.stringify({
    operation: 'chat',
    turnId,
    tenantId: user.tenantId,
    userId: user.id,
    role: user.role,
    status: outcome.status,
    provider: outcome.provider ?? null,
    model: outcome.model ?? null,
    fallback: outcome.attempts.length > 1,
    failure: outcome.failure ?? null,
    toolCalls: outcome.toolCallCount,
    latencyMs,
  });

  if (outcome.status === 'ok') console.info('[ai/chat] turn', line);
  else console.error('[ai/chat] turn', line);
}
