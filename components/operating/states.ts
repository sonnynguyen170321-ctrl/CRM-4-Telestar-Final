/**
 * One vocabulary for the operating model — labels, tone and iconography.
 *
 * The database speaks in enum values (`ready_for_outreach`, `human_attention`). A person reading
 * the screen should never see one. Every surface that renders a prospect's state — the dashboard,
 * the leads table, the prospect workspace, the AI Command Center — resolves it here, so a state
 * cannot mean one thing on one screen and something else on the next.
 *
 * Presentation only. Nothing here decides anything; it names what the CRM already decided.
 */

/** Semantic tones. Colour is never the only differentiator — each state also carries an icon. */
export type StatusTone = 'ai' | 'attention' | 'human' | 'waiting' | 'eligible' | 'neutral' | 'blocked' | 'done';

export interface StatusMeta {
  /** What a salesperson calls it. */
  label: string;
  tone: StatusTone;
  /** One sentence a presenter can read aloud. */
  hint: string;
}

/**
 * `Lead.operatingState` — who or what is responsible for the prospect right now.
 * Keys match `ProspectOperatingState` in `prisma/schema.prisma` exactly.
 */
export const OPERATING_STATE: Record<string, StatusMeta> = {
  unassigned: {
    label: 'Unassigned',
    tone: 'neutral',
    hint: 'Not yet in the operating loop.',
  },
  researching: {
    label: 'Researching',
    tone: 'ai',
    hint: 'AI is gathering evidence before any outreach.',
  },
  ready_for_outreach: {
    label: 'Ready for Outreach',
    tone: 'ai',
    hint: 'Qualified and grounded. Waiting on an approved sequence.',
  },
  ai_managed: {
    label: 'AI Managing',
    tone: 'ai',
    hint: 'AI is running outreach inside approved policy.',
  },
  human_attention: {
    label: 'Needs Attention',
    tone: 'attention',
    hint: 'The prospect replied. AI has stopped and handed over.',
  },
  human_managed: {
    label: 'SDR Managing',
    tone: 'human',
    hint: 'An SDR owns the conversation. AI assists on request only.',
  },
  waiting_for_prospect: {
    label: 'Waiting',
    tone: 'waiting',
    hint: 'Something was sent. The clock is running.',
  },
  reengagement_eligible: {
    label: 'Re-engagement Eligible',
    tone: 'eligible',
    hint: 'Gone quiet long enough that AI could follow up — if a human says so.',
  },
  ai_reengagement: {
    label: 'AI Re-engaging',
    tone: 'ai',
    hint: 'Handed back explicitly. A re-engagement work order is open.',
  },
  completed: {
    label: 'Completed',
    tone: 'done',
    hint: 'The loop closed on this prospect.',
  },
};

/** Console bucket keys (`lib/console/aiConsole.ts`) share the same visual system. */
export const BUCKET_TONE: Record<string, StatusTone> = {
  needs_attention: 'attention',
  ai_managed: 'ai',
  human_managed: 'human',
  waiting: 'waiting',
  reengagement_eligible: 'eligible',
  draft_available: 'ai',
  approval_pending: 'waiting',
  blocked: 'blocked',
};

export function operatingStateMeta(state: string | null | undefined): StatusMeta {
  if (!state) return { label: 'Unknown', tone: 'neutral', hint: 'No operating state recorded.' };
  return OPERATING_STATE[state] ?? { label: humanise(state), tone: 'neutral', hint: '' };
}

/**
 * Last-resort readable form for a value the map does not know about — so a state added later
 * degrades to `Some New State` rather than leaking `some_new_state` onto a demo screen.
 */
export function humanise(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ─── Priority ──────────────────────────────────────────────────────────────
   `Lead.crmPriorityScore` is the deterministic CRM enum hot / warm / cold. It is NOT a model
   confidence and NOT a 0-100 fit score, so nothing here invents a number. High / Medium / Low is
   the label; the enum is the truth. */

export type PriorityLevel = 'hot' | 'warm' | 'cold';

export const PRIORITY: Record<PriorityLevel, { label: string; tone: StatusTone; bars: number }> = {
  hot: { label: 'High', tone: 'attention', bars: 3 },
  warm: { label: 'Medium', tone: 'eligible', bars: 2 },
  cold: { label: 'Low', tone: 'neutral', bars: 1 },
};

export function priorityMeta(value: string | null | undefined) {
  const key = (value ?? 'warm') as PriorityLevel;
  return PRIORITY[key] ?? PRIORITY.warm;
}

/* ─── Ownership ─────────────────────────────────────────────────────────────
   Who is responsible is a different question from who the record is assigned to. A lead assigned
   to Sarah can still be AI-managed; the table must not let those read as the same thing. */

export const AI_OWNED_STATES = new Set(['researching', 'ready_for_outreach', 'ai_managed', 'ai_reengagement']);

export function isAiOwned(state: string | null | undefined): boolean {
  return !!state && AI_OWNED_STATES.has(state);
}
