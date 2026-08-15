import { generateStructured, isGenerationAvailable } from '@/lib/ai/generation';
import { buildHandoffPackage, type HandoffPackage } from './handoffPackage';

/**
 * AI assistance for a human-owned prospect (Phase 8c).
 *
 * `human_managed` means "AI may not touch the prospect", not "AI off" (ARCHITECTURE §4.3). So this
 * module produces things an SDR reads and decides about: a thread summary, a reply *draft*, help
 * with an objection, a recommended next action, meeting prep.
 *
 * ## It cannot send
 *
 * Structurally, not by policy: there is no send path here, no tool loop, no prospect-facing write
 * of any kind. It returns text. A human copies, edits and sends it themselves — which is the
 * difference between assistance and `prospect_reply`, the capability that is `human_only` at every
 * autonomy setting.
 *
 * ## Degradation
 *
 * No provider, or a failed call, returns `available: false` and a reason. The SDR loses a
 * convenience, not the prospect: the handoff package, the thread and the deterministic
 * recommendation are all still there.
 */

export type AssistKind = 'summary' | 'reply_draft' | 'objection_help' | 'next_action' | 'meeting_prep';

export const ALL_ASSIST_KINDS: readonly AssistKind[] = [
  'summary',
  'reply_draft',
  'objection_help',
  'next_action',
  'meeting_prep',
];

export function isAssistKind(value: string): value is AssistKind {
  return (ALL_ASSIST_KINDS as readonly string[]).includes(value);
}

export const ASSIST_LABEL: Record<AssistKind, string> = {
  summary: 'Thread summary',
  reply_draft: 'Suggested reply',
  objection_help: 'Objection support',
  next_action: 'Recommended next action',
  meeting_prep: 'Meeting prep',
};

const INSTRUCTION: Record<AssistKind, string> = {
  summary:
    'Summarise the conversation so far in at most four short bullet points. State what the prospect actually said, not what it might mean commercially.',
  reply_draft:
    'Draft a reply the SDR can send. Under 120 words, plain text, no subject line, no placeholders in square brackets. Answer what they asked and propose one concrete next step.',
  objection_help:
    'Identify the objection or hesitation in the prospect\'s message and give the SDR three short talking points to address it. If there is no objection, say so plainly.',
  next_action:
    'Recommend exactly one next action for the SDR, in one sentence, plus one sentence of reasoning.',
  meeting_prep:
    'Prepare the SDR for a call: three things to know about the account, and three questions to ask.',
};

const SYSTEM_PROMPT = `You assist a B2B sales development rep who has just taken over a conversation from an AI outreach agent.

Hard rules:
- You are writing to the SDR, never to the prospect. Nothing you produce is sent automatically.
- Use only the facts in the briefing. Do not invent customers, numbers, integrations, case studies or product capabilities.
- If the briefing does not support a claim, leave it out rather than hedging it.
- Be concise. An SDR reads this between calls.
- Plain text. No markdown headers, no preamble, no sign-off unless drafting a reply.`;

function renderBriefing(pkg: HandoffPackage): string {
  const evidence = pkg.whyContacted
    .slice(0, 8)
    .map((e) => `- (${e.kind}) ${e.summary}`)
    .join('\n');
  const thread = pkg.thread
    .slice(-6)
    .map((m) => `${m.direction === 'out' ? 'US' : 'THEM'} (${m.at.toISOString().slice(0, 10)}): ${(m.body ?? '').slice(0, 700)}`)
    .join('\n\n');

  return [
    `PROSPECT: ${pkg.prospect.name}${pkg.prospect.title ? `, ${pkg.prospect.title}` : ''} at ${pkg.prospect.company ?? 'unknown company'}`,
    pkg.account?.industry ? `INDUSTRY: ${pkg.account.industry}` : null,
    pkg.campaign ? `CAMPAIGN: ${pkg.campaign.name}${pkg.campaign.clientName ? ` (client: ${pkg.campaign.clientName})` : ''}` : null,
    evidence ? `WHY WE CONTACTED THEM:\n${evidence}` : 'WHY WE CONTACTED THEM: no research evidence on file.',
    pkg.latestReply
      ? `THEIR LATEST REPLY (${pkg.latestReply.kindLabel ?? 'unclassified'}):\n${(pkg.latestReply.body ?? '').slice(0, 1500)}`
      : 'THEIR LATEST REPLY: none on file.',
    thread ? `RECENT THREAD:\n${thread}` : null,
    `OBJECTIVE THE CRM RECOMMENDS: ${pkg.recommendedObjective}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface AssistInput {
  tenantId: string;
  leadId: string;
  kind: AssistKind;
  userId?: string | null;
  /** Skip the model — used by tests and by an explicitly offline demo. */
  disableAi?: boolean;
}

export interface AssistResult {
  available: boolean;
  kind: AssistKind;
  label: string;
  text: string | null;
  reason?: string;
  aiCallId?: string | null;
  model?: string;
  /** The deterministic recommendation, always present even when the model is not. */
  recommendedObjective: string;
  suggestedCallQuestions: string[];
}

export async function generateSdrAssist(input: AssistInput): Promise<AssistResult> {
  const pkg = await buildHandoffPackage(input.tenantId, input.leadId);
  if (!pkg) {
    return {
      available: false,
      kind: input.kind,
      label: ASSIST_LABEL[input.kind],
      text: null,
      reason: 'prospect not found',
      recommendedObjective: '',
      suggestedCallQuestions: [],
    };
  }

  const base = {
    kind: input.kind,
    label: ASSIST_LABEL[input.kind],
    recommendedObjective: pkg.recommendedObjective,
    suggestedCallQuestions: pkg.suggestedCallQuestions,
  };

  if (input.disableAi || !isGenerationAvailable()) {
    return { ...base, available: false, text: null, reason: 'no generation provider configured' };
  }

  const outcome = await generateStructured<string>(
    {
      tenantId: input.tenantId,
      leadId: input.leadId,
      userId: input.userId ?? null,
      operation: `sdr_assist_${input.kind}`,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `${renderBriefing(pkg)}\n\nTASK: ${INSTRUCTION[input.kind]}`,
      maxOutputTokens: 600,
    },
    // Prose, not JSON: the caller wants something an SDR can read and edit.
    (raw) => (raw.trim().length > 0 ? raw.trim() : null)
  );

  if (!outcome.available || !outcome.data) {
    return {
      ...base,
      available: false,
      text: null,
      reason: outcome.reason ?? 'generation failed',
      aiCallId: outcome.aiCallId,
    };
  }

  return {
    ...base,
    available: true,
    text: outcome.data,
    aiCallId: outcome.aiCallId,
    model: outcome.model,
  };
}
