import { prisma } from '@/lib/prisma';
import { canAccessLead, type SessionUser } from '@/lib/auth';
import { selectSkillModules, loadSkillModule, BASE_SDR_HEADER } from '@/lib/ai/skill-retriever';
import { generateStructured, isGenerationAvailable } from '@/lib/ai/generation';
import { getEvidenceForLead } from './engine';
import { validateEvidenceCitations } from './grounded-copy';

/**
 * Grounded sequence drafting (Phase 8a).
 *
 * Produces outreach **copy proposals** and nothing else: no enrollment, no task, no outbound
 * message, no send window, no operating-state change. `tests/phase-8a-prospecting.test.ts`
 * asserts that structurally. `sequence_design` and `outreach_launch` are separate work order
 * types precisely so approving words is not approving that a prospect receives them.
 *
 * **Why this lives in `lib/research/` and not `lib/sequences/`.** It imports `lib/ai`, and
 * `lib/sequences/` is core CRM: the automation engine and its workers must keep running when
 * every AI provider is down. `tests/ai-optional.test.ts` enforces that structurally.
 *
 * ## The retrieved skills are causally real
 *
 * `selectSkillModules` picks at most three modules, and their **content** is loaded into the
 * system prompt the model actually receives. An earlier revision called the retriever and threw
 * the result away, leaving fixed templates that no skill could influence — retrieval that
 * changes nothing is decoration. `buildDraftPrompt` is exported so a test can assert the
 * selected modules are present and the unselected ones are not.
 *
 * ## Grounding is a gate, and the model cannot self-certify past it
 *
 * Every **model-generated** step must cite at least one evidence row that was offered to it, and
 * every cited id is re-validated through `validateEvidenceCitations` after generation. An empty
 * citation array is not a claim of "this step asserts nothing" — the model writes both the prose
 * and the citations, so it could always omit one and slip an invented fact past the gate. A
 * generated step with no citation is dropped, and if any generated step fails the rule the whole
 * model draft fails grounding.
 *
 * The generic closing step, which asserts nothing about the prospect, is therefore **appended in
 * code** rather than requested from the model. Its provenance is structural: personalized copy
 * comes from the model and must cite; the closing line comes from here and cannot contain a fact
 * the model invented.
 *
 * ## Degradation
 *
 * With no provider, drafting falls back to an evidence-only template built from the same
 * validated rows, marked `aiGenerated: false`. It asserts nothing that is not already an
 * evidence row.
 */

export type DraftChannel = 'email' | 'phone' | 'linkedin' | 'whatsapp';

export interface SequenceDraftStep {
  order: number;
  channel: DraftChannel;
  /** Days after the previous step — delay *intent*. The scheduler owns timestamps. */
  delayDays: number;
  subject?: string;
  body: string;
  citedEvidenceIds: string[];
}

export interface SequenceDraft {
  leadId: string;
  tenantId: string;
  steps: SequenceDraftStep[];
  /** True only when every claim in every step is backed by valid, in-run evidence. */
  grounded: boolean;
  groundingReason?: string;
  /** The skill modules whose content went into the prompt — never more than three. */
  skillModules: string[];
  citedEvidenceIds: string[];
  /** False when the deterministic evidence-only fallback produced this draft. */
  aiGenerated: boolean;
  aiCallId?: string | null;
}

export class SequenceDraftAccessError extends Error {
  constructor(leadId: string) {
    super(`Unauthorized sequence draft request for lead ${leadId}`);
    this.name = 'SequenceDraftAccessError';
  }
}

export interface DraftSequenceInput {
  tenantId: string;
  leadId: string;
  channel?: DraftChannel;
  workOrderId?: string | null;
  agentActionId?: string | null;
}

interface EvidenceItem {
  id: string;
  kind: 'signal' | 'pain' | 'hook';
  text: string;
}

export async function draftSequenceForLead(
  user: SessionUser,
  input: DraftSequenceInput
): Promise<SequenceDraft> {
  const channel: DraftChannel = input.channel ?? 'email';

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      tenantId: true,
      firstName: true,
      lastName: true,
      company: true,
      title: true,
      accountId: true,
      contactId: true,
      assignedToId: true,
      campaignId: true,
      campaign: { select: { name: true } },
    },
  });

  if (!lead || lead.tenantId !== input.tenantId) throw new SequenceDraftAccessError(input.leadId);
  if (!(await canAccessLead(user, lead))) throw new SequenceDraftAccessError(input.leadId);

  const skillModules = selectSkillModules({ channel, operation: 'cold_email' });

  const evidenceBundle = await getEvidenceForLead(input.tenantId, input.leadId);
  const evidence: EvidenceItem[] = [
    ...evidenceBundle.companySignals.map((s) => ({
      id: s.id,
      kind: 'signal' as const,
      text: s.summary,
    })),
    ...evidenceBundle.accountPainHypotheses.map((p) => ({
      id: p.id,
      kind: 'pain' as const,
      text: p.hypothesis,
    })),
    ...evidenceBundle.personalizationHooks.map((h) => ({
      id: h.id,
      kind: 'hook' as const,
      text: h.angle,
    })),
  ];

  const context = {
    lead: {
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      company: lead.company,
      title: lead.title,
      campaign: lead.campaign?.name ?? null,
    },
    channel,
    evidence,
    skillModules,
  };

  const generated = isGenerationAvailable() ? await generateDraft(context, input, user) : null;
  const aiCallId = generated?.aiCallId ?? null;
  const knownIds = new Set(evidence.map((item) => item.id));

  // Personalized steps — from the model, or from the evidence-only fallback. Either way, each one
  // must be attached to evidence; the closing step is added afterwards, from code.
  const candidateSteps = generated?.steps ?? fallbackSteps(context);

  let grounded = candidateSteps.length > 0;
  let groundingReason: string | undefined;

  const cited = [...new Set(candidateSteps.flatMap((step) => step.citedEvidenceIds))];

  // 1. Nothing may be cited that was not offered to the generator. Checked first because it is
  //    the most specific thing that can be wrong with a draft.
  const invented = cited.filter((id) => !knownIds.has(id));
  // 2. And a step with no citation cannot be trusted to assert nothing: the model wrote both the
  //    prose and the citation list, so omitting one is free.
  const uncited = candidateSteps.filter((step) => step.citedEvidenceIds.length === 0);

  if (candidateSteps.length === 0) {
    grounded = false;
    groundingReason = 'no active research evidence for this lead';
  } else if (invented.length > 0) {
    grounded = false;
    groundingReason = `draft cited evidence that is not available for this lead: ${invented.join(', ')}`;
  } else if (uncited.length > 0) {
    grounded = false;
    groundingReason = `${uncited.length} generated step(s) asserted prospect copy without citing any evidence`;
  }

  // 3. And what was offered must still be valid, in scope, and inside its active research run.
  if (grounded) {
    const validation = await validateEvidenceCitations(
      input.tenantId,
      { accountId: lead.accountId, contactId: lead.contactId, leadId: lead.id },
      cited
    );
    if (!validation.valid) {
      grounded = false;
      groundingReason = validation.reason;
    }
  }

  // An ungrounded draft keeps **no** personalized step. Not the cited ones either: if any step in
  // the generation failed the rule, the generation is not trustworthy piecemeal.
  const personalized = grounded ? candidateSteps : [];
  const steps = [...personalized, closingStep(context, personalized.length + 1)].map(
    (step, index) => ({ ...step, order: index + 1 })
  );

  return {
    leadId: lead.id,
    tenantId: input.tenantId,
    steps,
    grounded,
    groundingReason,
    skillModules,
    citedEvidenceIds: grounded ? cited : [],
    aiGenerated: !!generated,
    aiCallId,
  };
}

/**
 * The generic closing step, written here rather than requested from the model.
 *
 * It mentions no fact about the prospect beyond their first name and company — both CRM fields —
 * so it needs no citation and cannot carry a hallucination. That is why it is appended in code:
 * "this step asserts nothing" is then a structural property, not the model's own claim.
 */
function closingStep(context: DraftContext, order: number): SequenceDraftStep {
  return {
    order,
    channel: context.channel,
    delayDays: 5,
    subject: `Closing the loop — ${context.lead.company}`,
    body: `${context.lead.firstName}, I have not heard back so I will assume the timing is wrong. If that changes, reply here and I will pick it up.`,
    citedEvidenceIds: [],
  };
}

interface DraftContext {
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    company: string;
    title: string | null;
    campaign: string | null;
  };
  channel: DraftChannel;
  evidence: EvidenceItem[];
  skillModules: string[];
}

async function generateDraft(
  context: DraftContext,
  input: DraftSequenceInput,
  user: SessionUser
): Promise<{ steps: SequenceDraftStep[]; aiCallId: string | null } | null> {
  const { systemPrompt, userPrompt } = buildDraftPrompt(context);

  const outcome = await generateStructured<SequenceDraftStep[]>(
    {
      tenantId: input.tenantId,
      userId: user.id,
      leadId: input.leadId,
      workOrderId: input.workOrderId ?? null,
      agentActionId: input.agentActionId ?? null,
      operation: 'sequence_draft',
      systemPrompt,
      userPrompt,
      maxOutputTokens: 1200,
    },
    (raw) => parseDraftSteps(raw, context.channel)
  );

  if (!outcome.available || !outcome.data) return null;
  return { steps: outcome.data, aiCallId: outcome.aiCallId };
}

/**
 * The exact prompt pair the model receives.
 *
 * Exported for the boundary test: it asserts the selected skill modules' content is present and
 * that unselected modules' content is not. Only the selected modules are loaded — the other five
 * files are never read.
 */
export function buildDraftPrompt(context: DraftContext): {
  systemPrompt: string;
  userPrompt: string;
} {
  const skillContent = context.skillModules
    .map((moduleId) => loadSkillModule(moduleId as Parameters<typeof loadSkillModule>[0]))
    .filter(Boolean)
    .join('\n\n---\n\n');

  const systemPrompt = [
    BASE_SDR_HEADER,
    '---',
    skillContent,
    '---',
    'GROUNDING RULES — these override the guidance above:',
    '- You may state a fact about the prospect ONLY if it appears in the EVIDENCE list, and you must put that evidence id in citedEvidenceIds for the step.',
    '- Never invent an evidence id. Never cite an id that is not listed.',
    '- EVERY step you write must cite at least one evidence id. If you cannot cite one, do not write the step.',
    '- Do not write a generic closing or break-up step; one is appended for you.',
    '- delayDays is an intent in days. Never output a date or a time.',
    '- You are drafting only. You cannot enroll, schedule or send anything.',
    'Reply with JSON: {"steps":[{"order":1,"channel":"email","delayDays":0,"subject":"...","body":"...","citedEvidenceIds":["..."]}]}',
  ].join('\n');

  const evidenceText = context.evidence.length
    ? context.evidence.map((item) => `- [${item.id}] (${item.kind}) ${item.text}`).join('\n')
    : '- (none — assert no facts about this prospect)';

  const userPrompt = [
    `CHANNEL: ${context.channel}`,
    `CAMPAIGN: ${context.lead.campaign ?? 'unspecified'}`,
    `PROSPECT: ${context.lead.firstName} ${context.lead.lastName}, ${context.lead.title ?? 'unknown title'} at ${context.lead.company}`,
    '',
    'EVIDENCE:',
    evidenceText,
    '',
    'Draft up to 2 personalized outreach steps for this prospect. Every step must cite evidence.',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function parseDraftSteps(raw: string, channel: DraftChannel): SequenceDraftStep[] | null {
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed) ? parsed : (parsed as { steps?: unknown })?.steps;
  if (!Array.isArray(list)) return null;

  const steps = list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, index) => ({
      order: typeof item.order === 'number' ? item.order : index + 1,
      channel: (typeof item.channel === 'string' && isChannel(item.channel) ? item.channel : channel),
      delayDays: typeof item.delayDays === 'number' ? Math.max(0, Math.round(item.delayDays)) : index * 3,
      subject: typeof item.subject === 'string' ? item.subject : undefined,
      body: String(item.body ?? ''),
      citedEvidenceIds: Array.isArray(item.citedEvidenceIds) ? item.citedEvidenceIds.map(String) : [],
    }))
    .filter((step) => step.body.trim().length > 0);

  return steps.length > 0 ? steps : null;
}

function isChannel(value: string): value is DraftChannel {
  return ['email', 'phone', 'linkedin', 'whatsapp'].includes(value);
}

/**
 * The no-provider fallback — personalized steps only.
 *
 * Restates evidence rows the CRM already holds, each citing the row it restates, so it is safe
 * to produce with no model available. The closing step is appended by the caller. Marked
 * `aiGenerated: false`.
 */
function fallbackSteps(context: DraftContext): SequenceDraftStep[] {
  const steps: SequenceDraftStep[] = [];
  const signal = context.evidence.find((item) => item.kind === 'signal');
  const hook = context.evidence.find((item) => item.kind === 'hook');

  if (signal) {
    steps.push({
      order: steps.length + 1,
      channel: context.channel,
      delayDays: 0,
      subject: `${context.lead.company} — quick thought`,
      body: `${context.lead.firstName}, saw this about ${context.lead.company}: "${truncate(signal.text, 160)}". Teams hitting that point usually feel it in outbound capacity first. Worth 15 minutes?`,
      citedEvidenceIds: [signal.id],
    });
  }

  if (hook) {
    steps.push({
      order: steps.length + 1,
      channel: context.channel,
      delayDays: 3,
      subject: `Following up — ${context.lead.company}`,
      body: `${context.lead.firstName}, one more angle: ${truncate(hook.text, 180)}. If that is not a priority this quarter, say so and I will close the loop.`,
      citedEvidenceIds: [hook.id],
    });
  }

  return steps;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
