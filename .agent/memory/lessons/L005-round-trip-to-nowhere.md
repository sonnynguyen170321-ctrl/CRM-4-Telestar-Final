---
id: L005
domain: telestar-ai
severity: medium
protection: test
---

# L005 — A feature that was fully wired to nothing

**Symptom.** "Summarise my day" produced plausible answers that were not built on the user's
day. The chatbox fetched `/api/ai/briefing?type=eod`, JSON-stringified the result and attached
it to the chat request as `context.eodData`. The route's schema accepted the key — and the
system prompt never read it. The model answered from conversation history while a full round
trip's worth of real figures sat unused in the request body.

**Root cause.** Two independently reasonable decisions. The client added `eodData` to the
context object. The server's context schema ended in `.passthrough()`, so the key survived
validation. Nobody wrote the line that consumed it, and nothing complained: passthrough's whole
job is to not complain.

**Why it deceives.** Every visible signal says the feature works. The network tab shows the
fetch. The request body contains the data. The answer is fluent and topical, because a language
model asked about someone's day will produce something day-shaped from whatever it has.

The failure mode of a plausible-but-ungrounded answer is that it is *indistinguishable from
success* without checking the numbers against the database.

**Permanent protection.** Test that the output tracks the source, by changing the source:

```ts
loadEodSummaryMock.mockResolvedValue({ tasksCompleted: 7, ... });
// -> prompt contains "Tasks completed: 7"
loadEodSummaryMock.mockResolvedValue({ tasksCompleted: 19, ... });
// -> prompt contains "Tasks completed: 19", and not "Tasks completed: 7"
```

Structurally: the server now detects the intent and loads the figures itself, under the
session's own role scope. Data the model reasons from is never routed through the browser.

**Where it applies.** Any context assembled from more than one source, and any prompt built
from an optional field. If no test would fail when the field is dropped, the field is
decorative.

- Related source: `app/api/ai/chat/route.ts`, `lib/briefing/service.ts`
- Related test: `tests/ai-chat-route.test.ts` — "answers an end-of-day request from CRM figures, and follows them when they change"
- Related lesson: [L003](./L003-comment-and-code-disagreed.md) — same `.passthrough()`, different consequence
