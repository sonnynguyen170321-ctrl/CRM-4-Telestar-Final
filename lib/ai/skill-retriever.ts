import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Always-loaded base header (~30 lines) covering identity, communication style,
 * and banned outreach phrases. Every AI SDR prompt includes this base context.
 */
export const BASE_SDR_HEADER = `# AI SDR ASSISTANT — IDENTITY & COMMUNICATION STYLE

- Always address the SDR by their first name (available in context)
- Be direct, warm, and confident — like a senior rep mentoring a junior one
- Never use corporate jargon: no "synergy", "leverage", "circle back", "reach out"
- When writing outreach copy: sound like a human who did research, not a machine
- Keep answers concise unless asked for detail. One good idea beats a list of five mediocre ones
- If you don't know something specific about a prospect, say so — never fabricate facts

### Banned phrases in all outreach copy you write:
- "I hope this email finds you well"
- "I wanted to reach out"
- "I came across your profile and..."
- "I believe we could add value"
- "Per my last email"
- "I would love to connect"
- "Does this sound like something you'd be interested in?"
- Any opener starting with "I" — always start with them, not you
`;

export type SkillModuleId =
  | 'cold-email'
  | 'cold-call'
  | 'qualification'
  | 'objection-handling'
  | 'meeting-booking'
  | 'research'
  | 'personalization'
  | 'reengagement';

export interface SkillRetrievalOptions {
  channel?: 'email' | 'phone' | 'linkedin' | 'whatsapp';
  operation?: string;
  topicText?: string;
  /** Who is asking. A leadgen user's default craft is not an SDR's. */
  role?: string;
  /** Where they are — the CRM surface, used only as a weak tie-breaker. */
  surface?: string;
}

const SKILLS_DIR = join(process.cwd(), 'lib', 'ai', 'skills');

/**
 * Loads a specific skill module file from disk.
 */
export function loadSkillModule(moduleId: SkillModuleId): string {
  const filePath = join(SKILLS_DIR, `${moduleId}.md`);
  if (!existsSync(filePath)) {
    return '';
  }
  return readFileSync(filePath, 'utf8');
}

/** Retrieval never loads more than this many modules, whatever the text says. */
export const MAX_RETRIEVED_SKILL_MODULES = 3;

/**
 * Topic classification. Declaration order is now only a tie-breaker: which modules survive
 * the cap is decided by relevance score in `selectSkillModules`, not by position here.
 *
 * **`call` is deliberately absent from the meeting-booking pattern.** It used to be there, so
 * "help me improve my cold call opener" retrieved the meeting-booking playbook: the word
 * matched, the intent did not. Phone-call craft belongs to `cold-call`; meeting-booking is
 * about asking for and holding the meeting.
 */
const TOPIC_RULES: ReadonlyArray<{
  module: SkillModuleId;
  operations: string[];
  pattern: RegExp;
}> = [
  {
    module: 'research',
    operations: ['research'],
    pattern: /\b(research|background|intel|company news|dig into|find out about)\b/i,
  },
  {
    module: 'qualification',
    operations: ['qualification'],
    pattern: /\b(qualify|qualifying|qualification|budget|authority|decision.?maker|timeline|bant|spin|discovery)\b/i,
  },
  {
    module: 'objection-handling',
    operations: ['objection'],
    pattern: /(\b(objection|objections|pushback|not interested|too expensive|no budget|brush.?off)\b|send me (?:some )?info)/i,
  },
  {
    module: 'meeting-booking',
    operations: ['meeting'],
    pattern: /\b(meeting|meetings|book|booking|schedule|scheduling|demo|calendar|invite)\b/i,
  },
  {
    module: 'reengagement',
    operations: ['reengagement'],
    pattern: /(\b(re-?engage|re-?engagement|ghosted|ghosting|no reply|nurture|gone quiet)\b|follow[- ]?up)/i,
  },
  {
    module: 'personalization',
    operations: ['personalization'],
    pattern: /\b(personali[sz]e|personali[sz]ed|personali[sz]ation|tailor|icebreaker|hook)\b/i,
  },
  {
    module: 'cold-call',
    operations: ['cold_call'],
    // No bare `dial` token: `tests/ai-optional.test.ts` fails the build on telephony words in
    // `lib/ai`, and the point of that guard is that this layer never places calls.
    pattern: /(\b(opener|dialer|gatekeeper|voicemail)\b|cold.?call|phone script)/i,
  },
  {
    module: 'cold-email',
    operations: ['cold_email'],
    pattern: /(cold.?email|\b(subject line|email copy)\b)/i,
  },
];

/** Weak affinities: real signal, but never enough to outrank an explicit topic match. */
const CHANNEL_AFFINITY: Record<string, SkillModuleId[]> = {
  email: ['cold-email', 'personalization'],
  phone: ['cold-call', 'objection-handling'],
  linkedin: ['personalization'],
  whatsapp: ['personalization'],
};

/** A leadgen user's default craft is sourcing, not closing. */
const ROLE_AFFINITY: Record<string, SkillModuleId[]> = {
  leadgen: ['research', 'personalization'],
  leadgen_manager: ['research', 'qualification'],
};

const SURFACE_AFFINITY: Array<{ match: RegExp; modules: SkillModuleId[] }> = [
  { match: /dialer|phone/i, modules: ['cold-call'] },
  { match: /sequence|template/i, modules: ['cold-email'] },
  { match: /meeting/i, modules: ['meeting-booking'] },
  { match: /leadgen/i, modules: ['research'] },
];

/**
 * Decides which skill modules a request needs, by **relevance score** rather than by
 * declaration order.
 *
 * The previous version collected every matching rule into a `Set` and took the first three.
 * Insertion order is `TOPIC_RULES` order, so which modules survived the cap was decided by how
 * the rules happen to be listed in this file — not by how well any of them matched. A message
 * squarely about objections that mentioned "meeting" once could lose `objection-handling` to a
 * rule declared earlier.
 *
 * Scoring keeps the same inputs honest and adds the two §XL asks for that were missing, role
 * and surface, as weak tie-breakers. It stays fully deterministic: no model call, no
 * embedding, and every case is assertable. Keyword patterns remain a *signal* rather than the
 * whole router, which is what §XL requires of them.
 *
 * Exported because it is the property worth testing: which modules are selected, and that the
 * count never exceeds {@link MAX_RETRIEVED_SKILL_MODULES}. Asserting on the concatenated
 * prompt string would test the markdown, not the routing.
 */
export function selectSkillModules(options: SkillRetrievalOptions = {}): SkillModuleId[] {
  const { channel, operation, topicText, role, surface } = options;
  const text = topicText || '';
  const scores = new Map<SkillModuleId, number>();

  const add = (moduleId: SkillModuleId, weight: number) => {
    scores.set(moduleId, (scores.get(moduleId) ?? 0) + weight);
  };

  for (const rule of TOPIC_RULES) {
    // An explicit operation is the strongest signal available: the caller named the intent
    // rather than the router inferring it.
    if (operation && rule.operations.includes(operation)) add(rule.module, 10);

    const matches = text.match(new RegExp(rule.pattern.source, 'gi'));
    // More distinct hits means the message is more about this topic, not merely adjacent to it.
    if (matches) add(rule.module, 4 + Math.min(matches.length - 1, 3));
  }

  if (channel) for (const moduleId of CHANNEL_AFFINITY[channel] ?? []) add(moduleId, 2);
  if (role) for (const moduleId of ROLE_AFFINITY[role] ?? []) add(moduleId, 1);
  if (surface) {
    for (const rule of SURFACE_AFFINITY) {
      if (rule.match.test(surface)) for (const moduleId of rule.modules) add(moduleId, 1);
    }
  }

  if (scores.size === 0) {
    // No signal at all. Research plus cold-email is the broadest useful pair for an SDR.
    return ['research', 'cold-email'];
  }

  return [...scores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      // Ties fall back to declaration order, which encodes editorial priority.
      return TOPIC_RULES.findIndex((r) => r.module === a[0]) - TOPIC_RULES.findIndex((r) => r.module === b[0]);
    })
    .slice(0, MAX_RETRIEVED_SKILL_MODULES)
    .map(([moduleId]) => moduleId);
}

/**
 * Maps channel & operation options to relevant skill modules.
 * Returns only the matching modules appended to the base SDR header.
 *
 * **Constraint**: The full set of 8 skills is NEVER loaded simultaneously.
 */
export function retrieveRelevantSkills(options: SkillRetrievalOptions = {}): string {
  const modulesContent = selectSkillModules(options)
    .map((modId) => loadSkillModule(modId))
    .filter(Boolean)
    .join('\n\n---\n\n');

  return `${BASE_SDR_HEADER}\n\n---\n\n${modulesContent}`;
}
