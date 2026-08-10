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
 * Topic classification, in priority order — the order also decides which modules survive the
 * cap when a message matches more than three.
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

/**
 * Decides which skill modules a request needs.
 *
 * Exported because it is the property worth testing: which modules are selected, and that the
 * count never exceeds {@link MAX_RETRIEVED_SKILL_MODULES}. Asserting on the concatenated
 * prompt string would test the markdown, not the routing.
 */
export function selectSkillModules(options: SkillRetrievalOptions = {}): SkillModuleId[] {
  const { channel, operation, topicText } = options;
  const text = topicText || '';
  const selected = new Set<SkillModuleId>();

  for (const rule of TOPIC_RULES) {
    if ((operation && rule.operations.includes(operation)) || rule.pattern.test(text)) {
      selected.add(rule.module);
    }
  }

  // Channel mapping, only when the text carried no topic signal of its own.
  if (selected.size === 0 && channel) {
    if (channel === 'email') {
      selected.add('cold-email');
      selected.add('personalization');
    } else if (channel === 'phone') {
      selected.add('cold-call');
      selected.add('objection-handling');
    } else if (channel === 'linkedin' || channel === 'whatsapp') {
      selected.add('personalization');
    }
  }

  // Default when there is no context at all.
  if (selected.size === 0) {
    selected.add('research');
    selected.add('cold-email');
  }

  return Array.from(selected).slice(0, MAX_RETRIEVED_SKILL_MODULES);
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
