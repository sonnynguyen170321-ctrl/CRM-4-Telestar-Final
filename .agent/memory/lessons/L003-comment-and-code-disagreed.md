---
id: L003
domain: api-contracts
severity: high
protection: test
---

# L003 — The comment described the safe version

**Symptom.** The chat route's context schema carried a comment stating that unknown keys were
`.strip()`ped, so a client could not smuggle extra prompt text through the context object.
Eleven lines below, the schema ended in `.passthrough()`.

**Root cause.** The comment described an intended design. The code implemented the opposite.
Both were written by someone who believed the first sentence.

The same object also accepted client-supplied performance counters — overdue tasks, calls
today — which the server then presented to the model as CRM truth. An SDR with dev tools could
report zero overdue work and every answer built on it, including anything a manager later read,
would agree.

**Why it deceives.** A reviewer reading top-to-bottom sees a clear statement of the security
property and stops evaluating. Comments are trusted more than code precisely because someone
chose to write them. A stale comment is worse than none: it actively answers the question the
reviewer was about to ask.

It also passes every test that exercises well-formed input, which is every test anyone writes
first.

**Permanent protection.** Test the property, not the intent:

```ts
const prompt = executeMock.mock.calls[0][0].systemPrompt as string;
expect(prompt).not.toContain('999');                          // client counter
expect(prompt).not.toContain('ignore previous instructions');  // arbitrary key
```

Structurally, the durable fix was narrowing what the boundary accepts at all: `page` and
`leadId`, nothing else. Identity, role, tenant and every counter are read server-side. A field
that cannot be sent cannot be trusted by mistake.

**Where it applies.** Any comment asserting a security or invariant property. Treat it as a
claim needing a test, not as documentation.

- Related source: `app/api/ai/chat/route.ts`
- Related test: `tests/ai-chat-route.test.ts` — "ignores performance counters a client attaches"
