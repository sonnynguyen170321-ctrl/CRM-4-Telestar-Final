import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * One gateway, one router, three providers — enforced structurally rather than by convention.
 *
 * The production chat outage was not caused by a bad model id on its own. It was caused by
 * *three* places that each knew how to reach a provider — the gateway, `lib/ai/provider.ts`
 * for chat, and `lib/ai/providerRouting.ts` for background generation — disagreeing about
 * which model to call and what counted as a failure worth failing over. Chat hard-coded a
 * withdrawn Groq model, got a 404, and the legacy router only failed over on rate limits, so
 * every message ended in "Sorry, I ran into a problem generating that."
 *
 * Deleting those two modules fixed that outage. This test is what stops the third one from
 * being written: a provider SDK client constructed anywhere outside the adapter layer is a
 * second path to a model, and it will not have the gateway's routing, circuit breaker,
 * timeout, budget reservation or attribution.
 *
 * This is deliberately a source scan and not a runtime assertion. A new file importing
 * `openai` and calling it directly would pass every behavioural test in the suite — that is
 * exactly how the previous duplication survived for as long as it did.
 */

const ROOT = process.cwd();

/** Runtime trees. A provider client here reaches real users. */
const RUNTIME_DIRS = ['lib', 'app', 'components', 'workers', 'context', 'hooks'];

/**
 * The only modules permitted to construct a provider SDK client.
 *
 * `providerAdapters.ts` owns the SDK calls; `gateway.ts` owns the lazily-constructed clients
 * it hands them. Adding a path here is a deliberate architectural decision and should be
 * argued for in review, which is the entire point of the list being short and explicit.
 */
const ALLOWED = new Set([
  path.join('lib', 'ai', 'gateway.ts'),
  path.join('lib', 'ai', 'providerAdapters.ts'),
]);

/** Constructing a client, or importing an SDK in order to. */
const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'new OpenAI(', pattern: /\bnew\s+OpenAI\s*\(/ },
  { label: 'new Groq(', pattern: /\bnew\s+Groq\s*\(/ },
  { label: 'new GoogleGenerativeAI(', pattern: /\bnew\s+GoogleGenerativeAI\s*\(/ },
  { label: 'new GoogleGenAI(', pattern: /\bnew\s+GoogleGenAI\s*\(/ },
  { label: "import from 'openai'", pattern: /from\s+['"]openai['"]/ },
  { label: "import from 'groq-sdk'", pattern: /from\s+['"]groq-sdk['"]/ },
  { label: "import from '@google/generative-ai'", pattern: /from\s+['"]@google\/generative-ai['"]/ },
  { label: "import from '@google/genai'", pattern: /from\s+['"]@google\/genai['"]/ },
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A type-only import pulls in no runtime client.
 *
 * `providerAdapters.ts` legitimately imports `type { GoogleGenerativeAI }` to type the client
 * the gateway passes it, and a rule that cannot tell that apart would push callers toward
 * `any` to satisfy the test — strictly worse than what it was protecting.
 */
function isTypeOnlyImport(line: string): boolean {
  return /^\s*import\s+type\s/.test(line) || /^\s*import\s*\{\s*type\s/.test(line);
}

describe('provider client containment', () => {
  it('constructs provider SDK clients only inside the adapter layer', () => {
    const offenders: string[] = [];

    for (const dir of RUNTIME_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const relative = path.relative(ROOT, file);
        if (ALLOWED.has(relative)) continue;

        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (isTypeOnlyImport(line)) return;
          for (const { label, pattern } of FORBIDDEN_PATTERNS) {
            if (pattern.test(line)) {
              offenders.push(`${relative}:${index + 1} — ${label}`);
            }
          }
        });
      }
    }

    expect(
      offenders,
      `Provider SDK access outside the adapter layer. Every model call goes through ` +
        `lib/ai/gateway.ts so it inherits routing, failover, circuit breaking, budget ` +
        `reservation and AiCall attribution:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has not resurrected the legacy routing modules', () => {
    // Named explicitly: these two are what the one-gateway rule replaced, and a file
    // reappearing under either name would be the same architecture returning under its own
    // original name.
    for (const legacy of [path.join('lib', 'ai', 'provider.ts'), path.join('lib', 'ai', 'providerRouting.ts')]) {
      let exists = true;
      try {
        statSync(path.join(ROOT, legacy));
      } catch {
        exists = false;
      }
      expect(exists, `${legacy} is back — there is one router, and it is lib/ai/router.ts`).toBe(false);
    }
  });
});
