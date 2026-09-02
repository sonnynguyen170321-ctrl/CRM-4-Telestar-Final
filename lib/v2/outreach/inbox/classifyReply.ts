// Deterministic inbound-reply classifier. Turns a reply's subject + body (+ optional
// provider signals) into an SDR-actionable category so the inbox can triage without AI.
// Pure; keyword/heuristic based. Order matters: hard signals (bounce/unsubscribe/OOO) win
// before softer intent.

export type ReplyClass =
  | "BOUNCE"
  | "AUTO_REPLY"        // out-of-office / auto-responder
  | "UNSUBSCRIBE"
  | "NOT_INTERESTED"
  | "MEETING_INTENT"    // wants to talk / book time
  | "POSITIVE"          // interested / asking questions
  | "NEEDS_REVIEW";     // human reply, unclear intent

export type ClassifyReplyInput = {
  subject?: string | null;
  body?: string | null;
  isBounce?: boolean;   // provider/DSN signal
  isAutoReply?: boolean; // Auto-Submitted / X-Autoreply header signal
};

const RE = {
  bounce: /\b(delivery (has )?failed|undeliverable|mailer-daemon|delivery status notification|address not found|does not exist|mailbox (full|unavailable))\b/i,
  ooo: /\b(out of (the )?office|on (annual |vacation |parental )?leave|away from my desk|will be back|auto[- ]?reply|automatic reply|currently (out|away)|maternity leave)\b/i,
  unsub: /\b(unsubscribe|opt[- ]?out|remove me|take me off|stop emailing|do not (contact|email))\b/i,
  notInterested: /\b(not interested|no thanks|no thank you|we('| a)re (all )?set|already have|not a (good )?fit|please stop|not the right time|no budget)\b/i,
  meeting: /\b(book a (call|time|meeting|demo)|schedule a (call|time|meeting|demo)|calendar|calendly|happy to (chat|talk|connect)|let'?s (talk|chat|connect|set up)|what times?|when (are|works)|jump on a call|set up a call)\b/i,
  positive: /\b(interested|tell me more|sounds (good|great|interesting)|learn more|send (me )?(more|info|details)|how (does|much)|pricing|curious|keen)\b/i,
};

export function classifyReply(input: ClassifyReplyInput): ReplyClass {
  const text = `${input.subject ?? ""}\n${input.body ?? ""}`;
  if (input.isBounce || RE.bounce.test(text)) return "BOUNCE";
  if (input.isAutoReply || RE.ooo.test(text)) return "AUTO_REPLY";
  if (RE.unsub.test(text)) return "UNSUBSCRIBE";
  if (RE.notInterested.test(text)) return "NOT_INTERESTED";
  if (RE.meeting.test(text)) return "MEETING_INTENT";
  if (RE.positive.test(text)) return "POSITIVE";
  return "NEEDS_REVIEW";
}

const LABELS: Record<ReplyClass, { label: string; tone: "green" | "blue" | "amber" | "red" | "slate" }> = {
  MEETING_INTENT: { label: "Meeting intent", tone: "green" },
  POSITIVE: { label: "Positive", tone: "green" },
  NEEDS_REVIEW: { label: "Needs review", tone: "amber" },
  NOT_INTERESTED: { label: "Not interested", tone: "slate" },
  UNSUBSCRIBE: { label: "Unsubscribe", tone: "red" },
  AUTO_REPLY: { label: "Auto-reply", tone: "slate" },
  BOUNCE: { label: "Bounce", tone: "red" },
};

export function replyClassLabel(cls: ReplyClass): { label: string; tone: "green" | "blue" | "amber" | "red" | "slate" } {
  return LABELS[cls];
}
