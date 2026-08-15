import { generateStructured, isGenerationAvailable } from '@/lib/ai/generation';
import {
  KIND_CLASS,
  MIN_AI_CONFIDENCE,
  isReplyKind,
  type ReplyClassification,
  type ReplyKind,
} from './types';

/**
 * Classify one inbound reply (Phase 8b).
 *
 * ## Deterministic first, model second, human review last
 *
 * ```text
 * unambiguous phrase match      → deterministic, confidence 1
 * otherwise, model available    → ai, confidence from the model
 * model unavailable / unusable  → high-precision phrase fallback, else class D
 * ```
 *
 * The order is not a cost optimisation. "Please unsubscribe me" has one correct answer and no
 * model should be able to return a different one, and the same is true of an out-of-office
 * auto-responder. Sending those to a provider would make a legally-significant stop depend on an
 * API being up.
 *
 * ## It never throws, and never guesses
 *
 * The CRM must keep processing inbound mail when the AI is down. A model result that is missing,
 * unparseable, unrecognised or low-confidence therefore resolves to **D** — falling back to C would
 * manufacture urgent SDR tasks out of provider outages, and falling back to A would silently stop
 * real conversations. D costs a human ten seconds and is recoverable.
 *
 * The one exception is a provider that never answered at all. Sending "How much does this cost?"
 * to human review because an API key is missing is technically safe and practically wrong, so a
 * narrow set of high-precision phrases (`ENGAGEMENT_FALLBACK`) is consulted first in that case.
 * It is *not* consulted when the model did answer — a model that said "unclear" has made a
 * judgement, and a keyword list must not overrule it.
 */

export interface ClassifyInput {
  subject: string | null;
  body: string | null;
  /** The provider marked it as an auto-responder. Strong evidence for class B, not proof. */
  isAutoReply?: boolean;
  tenantId: string;
  leadId?: string | null;
  workOrderId?: string | null;
  /** Skip the model entirely — used by tests and by the deterministic-only demo path. */
  disableAi?: boolean;
}

interface Rule {
  kind: ReplyKind;
  pattern: RegExp;
  rationale: string;
}

/**
 * Phrases with exactly one meaning.
 *
 * Order matters: a message can contain both "unsubscribe" and a question, and the stop wins.
 * Anything requiring judgement — "interesting", "we're reviewing this", "how does it work" — is
 * deliberately **not** here. Those are the cases the model exists for, and a keyword list that
 * tried to cover them would misfire on negations it cannot see.
 */
const DETERMINISTIC_RULES: readonly Rule[] = [
  {
    kind: 'unsubscribe',
    pattern: /\b(unsubscribe|opt[\s-]?out|remove me from (your |this )?(list|mailing)|take me off (your |this )?list|stop (emailing|contacting) me)\b/i,
    rationale: 'Explicit opt-out request.',
  },
  {
    kind: 'left_company',
    pattern: /\b(no longer (with|at|works? (for|at))|has left the (company|organi[sz]ation)|is no longer employed)\b/i,
    rationale: 'The contact has left the company.',
  },
  {
    kind: 'out_of_office',
    pattern: /\b(out of (the )?office|away from (the |my )?(office|desk)|on annual leave|on vacation|on holiday|currently travell?ing|auto[\s-]?reply)\b/i,
    rationale: 'Automatic out-of-office response.',
  },
  {
    kind: 'extended_leave',
    pattern: /\b(maternity|paternity|parental|medical|sick|sabbatical) leave\b/i,
    rationale: 'The contact is on extended leave.',
  },
  {
    kind: 'wrong_person',
    pattern: /\b(wrong person|not the right person|i'?m not (the |)(right )?(person|contact)|you (have|'ve) got the wrong)\b/i,
    rationale: 'Not the right contact for this.',
  },
];

/** Deterministic classification, or null when the message needs judgement. */
export function classifyDeterministic(input: {
  subject: string | null;
  body: string | null;
  isAutoReply?: boolean;
}): ReplyClassification | null {
  const text = `${input.subject ?? ''}\n${input.body ?? ''}`;

  for (const rule of DETERMINISTIC_RULES) {
    if (rule.pattern.test(text)) {
      return {
        replyClass: KIND_CLASS[rule.kind],
        kind: rule.kind,
        confidence: 1,
        source: 'deterministic',
        rationale: rule.rationale,
      };
    }
  }

  // A provider-flagged auto-responder whose wording we did not recognise is still administrative:
  // whatever it says, a machine sent it, so there is no prospect on the other end to hand to an SDR.
  if (input.isAutoReply) {
    return {
      replyClass: 'B',
      kind: 'out_of_office',
      confidence: 0.9,
      source: 'deterministic',
      rationale: 'Automatic response from the recipient mail server.',
    };
  }

  return null;
}

/**
 * High-precision sales-engagement phrases, used **only when no model answered**.
 *
 * Without these, a provider outage sent "How much does this cost?" to human review alongside a
 * genuinely unreadable reply — technically safe, practically wrong, and it makes the whole feature
 * depend on an API being up. These are narrow on purpose: each is a phrase whose *intent* is
 * unambiguous even though its *nuance* is not, which is why they carry a lower confidence than the
 * A/B rules and are never consulted while the model is reachable.
 *
 * Anything not matched here still falls to D. The fallback narrows human review; it does not
 * replace it.
 */
const ENGAGEMENT_FALLBACK: readonly Rule[] = [
  {
    kind: 'pricing',
    pattern: /\b(how much (does|would|is)|what('| i)?s the (cost|price|pricing)|pricing (info|details|page)|what does (it|this) cost|ballpark (figure|price)|budget for this)\b/i,
    rationale: 'Asks about cost or commercial terms.',
  },
  {
    kind: 'meeting_request',
    pattern: /\b(book a (call|meeting|demo)|set up a (call|meeting|time)|schedule a (call|meeting|demo)|happy to (chat|talk|meet)|(does|would) (next |this )?(week|monday|tuesday|wednesday|thursday|friday) work)\b/i,
    rationale: 'Proposes or accepts a meeting.',
  },
  {
    kind: 'interest',
    pattern: /\b(this is interesting|sounds interesting|(send|share) (me )?(more|further) (detail|info)|tell me more|keen to (learn|hear) more|we('| a)re (actually )?(reviewing|looking at|evaluating))\b/i,
    rationale: 'Expresses interest and asks for more.',
  },
  {
    kind: 'referral',
    pattern: /\b((the )?(right|best) person (is|would be)|you should (speak|talk) (to|with)|(cc|copying|looping) in\b|forwarded (this )?to)\b/i,
    rationale: 'Points to a different person.',
  },
  {
    kind: 'rejection',
    pattern: /\b(not interested|no thanks|we('| a)re (all )?(set|good|covered)|not a (fit|priority) (for us|right now)|please stop)\b/i,
    rationale: 'Declines.',
  },
];

/**
 * The answer to give when no model did.
 *
 * `fallback` as a source, so the audit trail never claims a model classified something it did not.
 */
function classifyWithoutModel(input: ClassifyInput, reason: string): ReplyClassification {
  const text = `${input.subject ?? ''}\n${input.body ?? ''}`;
  const hit = ENGAGEMENT_FALLBACK.find((rule) => rule.pattern.test(text));
  if (hit) {
    return {
      replyClass: KIND_CLASS[hit.kind],
      kind: hit.kind,
      // Below 1 deliberately: this is a phrase match standing in for judgement, and the number
      // shown to the SDR should say so.
      confidence: 0.7,
      source: 'fallback',
      rationale: `${hit.rationale} (${reason})`,
    };
  }
  return {
    ...HUMAN_REVIEW,
    source: 'fallback',
    rationale: `${reason} — routed to human review.`,
  };
}

const SYSTEM_PROMPT = `You classify replies that B2B sales prospects send to outbound emails.

Answer with JSON only, no prose, in exactly this shape:
{"kind":"<kind>","confidence":<0-1>,"rationale":"<one short sentence>"}

Valid kinds and what they mean:
- rejection: the prospect declines, is not interested, says no.
- out_of_office / extended_leave / left_company / wrong_person: administrative, no selling signal.
- interest: expresses interest or curiosity, asks for more detail.
- question: asks something about the product, process or implementation.
- objection: raises a concern, doubt or blocker.
- pricing: asks about cost, budget or commercial terms.
- meeting_request: proposes or accepts a call, demo or meeting.
- referral: points to a different person who should be involved.
- unclear: you cannot tell, or the message is too short to judge.

Rules:
- If several apply, pick the one that best describes what the sender wants next.
- Use "unclear" whenever you are not confident. A wrong confident answer is far worse than "unclear".
- confidence is your own honesty about the answer, not enthusiasm about the reply.
- Never infer facts about the company or the product. You are labelling intent only.`;

function parseModelJson(raw: string): { kind: string; confidence: number; rationale?: string } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { kind?: unknown; confidence?: unknown; rationale?: unknown };
    if (typeof parsed.kind !== 'string') return null;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    return {
      kind: parsed.kind,
      confidence: Math.max(0, Math.min(1, confidence)),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
    };
  } catch {
    return null;
  }
}

const HUMAN_REVIEW: Omit<ReplyClassification, 'source' | 'rationale'> = {
  replyClass: 'D',
  kind: 'unclear',
  confidence: 0,
};

export async function classifyReply(input: ClassifyInput): Promise<ReplyClassification> {
  const deterministic = classifyDeterministic(input);
  if (deterministic) return deterministic;

  if (input.disableAi || !isGenerationAvailable()) {
    return classifyWithoutModel(input, 'no classifier available');
  }

  const outcome = await generateStructured(
    {
      tenantId: input.tenantId,
      leadId: input.leadId ?? null,
      workOrderId: input.workOrderId ?? null,
      operation: 'reply_classification',
      systemPrompt: SYSTEM_PROMPT,
      // Truncated: a classifier needs the opening of a reply, not a forwarded thread. It also
      // bounds what a prospect's mail can inject into the prompt.
      userPrompt: `Subject: ${input.subject ?? '(none)'}\n\n${(input.body ?? '').slice(0, 4000)}`,
      maxOutputTokens: 200,
    },
    parseModelJson
  );

  if (!outcome.available || !outcome.data) {
    return {
      ...classifyWithoutModel(input, `classifier unavailable: ${outcome.reason ?? 'unknown'}`),
      aiCallId: outcome.aiCallId,
    };
  }

  const { kind, confidence, rationale } = outcome.data;

  // An unrecognised label is not a class. The model inventing a vocabulary is exactly the case
  // human review exists for.
  if (!isReplyKind(kind)) {
    return {
      ...HUMAN_REVIEW,
      source: 'ai',
      rationale: `Unrecognised classification "${kind}" — routed to human review.`,
      aiCallId: outcome.aiCallId,
    };
  }

  // Demote low confidence to review — never up to a stop, and never into an urgent interrupt.
  if (confidence < MIN_AI_CONFIDENCE) {
    return {
      replyClass: 'D',
      kind: 'unclear',
      confidence,
      source: 'ai',
      rationale: rationale ?? 'Low confidence — routed to human review.',
      aiCallId: outcome.aiCallId,
    };
  }

  // A model may not issue a deterministic stop. Unsubscribe is a legal boundary and belongs to the
  // phrase rules above; a model-claimed "unsubscribe" is treated as an ordinary rejection, which
  // stops outreach without asserting an opt-out the prospect may not have made.
  const safeKind: ReplyKind = kind === 'unsubscribe' ? 'rejection' : kind;

  return {
    replyClass: KIND_CLASS[safeKind],
    kind: safeKind,
    confidence,
    source: 'ai',
    rationale: rationale ?? 'Classified by the reply model.',
    aiCallId: outcome.aiCallId,
  };
}
