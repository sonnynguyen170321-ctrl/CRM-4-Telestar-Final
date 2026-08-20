---
id: L002
domain: testing-certification
severity: critical
protection: automated
---

# L002 — A check that passes when it checked nothing

**Symptom.** `scripts/ai-provider-smoke.ts` reported `0/0 passed` and exited **0** on a
container with no AI credentials at all. Certification read that as a green signal for a
deployment where Telestar AI could not answer a single message. Two keys out of three passed
the same way.

**Root cause.** The script probed only providers whose keys were present, then exited non-zero
only if a probe *failed*. No probes meant no failures.

```ts
if (present('OPENAI_API_KEY')) probes.push(await probeOpenAi(model));   // ...
process.exit(probes.filter(p => p.status === 'FAIL').length > 0 ? 1 : 0);
```

**Why it deceives.** The logic reads as correct — "fail if any provider fails" is a sentence
nobody argues with. The bug is in the quantifier, not the predicate. And it is invisible in
every environment that *is* configured, which is every environment anyone tests it in.

The same shape appears wherever a loop over discovered items decides an outcome: a coverage
check that finds no files, a drift check that matches no paths, a migration replay with no
migrations.

**Permanent protection.** Assert the *expected count*, not just the absence of failures.

```
three configured, three attempted, three passed — or non-zero
```

No partial-credit mode and no override flag: the only reason to want one is to make a red
deployment look green. `check-test-discipline` applies the same principle to Vitest, failing
when suites that should have run silently skipped.

**Where it applies.** Any gate whose subject set is discovered rather than declared.

- Related source: `scripts/ai-provider-smoke.ts`, `scripts/check-test-discipline.mjs`
- Related invariant: [`INVARIANTS.md`](../INVARIANTS.md) — evidence must be positive
