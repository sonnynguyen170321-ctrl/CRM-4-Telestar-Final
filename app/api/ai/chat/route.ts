import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { streamChat, DEFAULT_MODEL } from '@/lib/ai/provider';
import type { ModelId } from '@/lib/ai/provider';
import { loadAuthorizedLeadContext } from '@/lib/leads/context';
import { isValidExecutionId } from '@/lib/ai/executionId';
import { retrieveRelevantSkills } from '@/lib/ai/skill-retriever';

interface ChatContext {
  page?: string;
  /**
   * Which prospect the SDR has open. Client-supplied and used only to label the AiCall
   * accounting row — it grants nothing and is never read for authorization, so it is
   * bounded rather than verified. `sanitizeLeadId` drops anything that is not id-shaped.
   */
  leadId?: string;
  userName?: string;
  userRole?: string;
  overdueTasks?: number;
  todayTasks?: number;
  sdrCallsToday?: number;
  sdrEmailsToday?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Accept only cuid-shaped ids, so a hostile client cannot write arbitrary text to AiCall. */
function sanitizeLeadId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9]{20,32}$/i.test(value) ? value : undefined;
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { messages, modelId, context, executionId: clientExecutionId } = await req.json() as {
    messages: ChatMessage[];
    modelId?: ModelId;
    context?: ChatContext;
    executionId?: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

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

  // Build live context block
  const contextLines: string[] = [];
  if (context?.page) contextLines.push(`Current page: ${context.page}`);
  if (context?.overdueTasks != null) contextLines.push(`Overdue tasks: ${context.overdueTasks}`);
  if (context?.todayTasks != null) contextLines.push(`Tasks due today: ${context.todayTasks}`);
  if (context?.sdrCallsToday != null) contextLines.push(`Calls logged today: ${context.sdrCallsToday}`);
  if (context?.sdrEmailsToday != null) contextLines.push(`Emails sent today: ${context.sdrEmailsToday}`);

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

  const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content || '';
  const relevantSkills = retrieveRelevantSkills({ channel: inferredChannel, operation: 'chat', topicText: lastUserMessage });

  const systemPrompt = `You are the AI SDR Assistant for ${user.firstName} ${user.lastName} (${user.role} at Telestar).
Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.${memoryBlock}${contextBlock}

${relevantSkills}

IMPORTANT REMINDERS:
- Always address the SDR by their first name: ${user.firstName}
- Never make calls, send emails, or complete tasks autonomously — you coach humans who take the actions
- When you learn something important the SDR tells you, say "I'll remember that" and they can confirm
- Role-based note: ${user.role === 'sdr' || user.role === 'leadgen' ? 'This SDR sees only their own leads and tasks.' : `This user has ${user.role} access and can see team-level data.`}`;

  // Detect today's date for task tool
  const today = new Date().toISOString().split('T')[0];

  // Set up streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = streamChat({
          messages: messages.map((m) => ({ role: m.role, content: m.content })) as Array<{role: 'user' | 'assistant' | 'system'; content: string}>,
          systemPrompt,
          modelId: (modelId as ModelId) || DEFAULT_MODEL,
          today,
          operation: 'chat',
          leadId: sanitizeLeadId(context?.leadId),
          sessionUser: user,
          // Never invented server-side. A generated id would be unique per request, which
          // is precisely what idempotency must not be: a retry would get a fresh namespace
          // and write a second CRM row. Absent or malformed means write-capable tools are
          // refused for this turn — see `streamChat`.
          executionId: isValidExecutionId(clientExecutionId) ? clientExecutionId : undefined,
          playbookVersionId,
        });

        for await (const chunk of generator) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        // Never leak raw provider error payloads (JSON, stack traces) to the SDR.
        const raw = err instanceof Error ? err.message : 'AI error';
        const isRate = /rate.?limit|\b429\b|tokens per day|\bTPD\b|quota/i.test(raw);
        console.error('[ai/chat] stream error:', raw);
        const friendly = isRate
          ? "I've hit today's usage limit on the AI models — please try again in a little while."
          : 'Sorry, I ran into a problem generating that. Please try again in a moment.';
        controller.enqueue(encoder.encode(friendly));
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
    },
  });
}
