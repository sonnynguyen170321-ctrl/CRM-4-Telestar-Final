import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { CHAT_OUTPUT_BUDGET_TOKENS, MODEL_REGISTRY } from '@/lib/ai/registry';

/**
 * No production caller may leave the output budget to the registry default.
 *
 * This exists because of what it replaced. `scripts/ai-provider-smoke.ts` sent
 * `parameters.defaultMaxOutputTokens` — 8192 — on the reasoning that "the registry grants it,
 * so that is what the runtime sends". The runtime does not: chat sends 1200, `generation.ts`
 * sends 1200, onboarding sends 130. Nothing in the product had ever asked for 8192.
 *
 * That mattered the day a provider tier capped tokens-per-minute at 8,000. The gate failed on a
 * request no user could produce, the release gate went red, and the product was fine. A gate
 * asserting against a path the product does not exercise is weaker than it looks in both
 * directions: it fails on phantoms, and it would not notice the real regression.
 *
 * So the smoke now sends what the runtime sends, and the protection the 8192 was *incidentally*
 * providing — that no caller silently falls back to the default — is asserted here directly,
 * where it can actually fail for the right reason.
 */

const GATEWAY_CALL = /aiGateway\.(generate|stream|execute)\s*\(\s*\{/g;

/** Production trees only. Scripts and tests legitimately probe with their own budgets. */
const PRODUCTION_DIRS = ['app', 'lib', 'workers', 'components', 'context', 'hooks'];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(walk(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** The argument object of a call, from its opening brace to the matching close. */
function callArgumentSource(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }
  return source.slice(openBraceIndex);
}

describe('output budget', () => {
  it('is set explicitly at every production gateway call site', () => {
    const uncapped: string[] = [];

    for (const dir of PRODUCTION_DIRS) {
      for (const file of walk(dir)) {
        const source = readFileSync(file, 'utf8');
        GATEWAY_CALL.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = GATEWAY_CALL.exec(source)) !== null) {
          const brace = source.indexOf('{', match.index + match[0].length - 1);
          const args = callArgumentSource(source, brace);
          if (!/\bmaxTokens\s*:/.test(args)) {
            const line = source.slice(0, match.index).split('\n').length;
            uncapped.push(`${file.replace(/\\/g, '/')}:${line} ${match[1]}`);
          }
        }
      }
    }

    expect(uncapped, 'these fall back to the registry default, which no gate exercises').toEqual([]);
  });

  it('keeps the shared budget below every model’s hard ceiling', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(CHAT_OUTPUT_BUDGET_TOKENS).toBeLessThanOrEqual(model.maxOutputTokens);
    }
  });

  it('leaves a reasoning model room to think before it writes', () => {
    // `openai/gpt-oss-20b` spends roughly thirty output tokens reasoning before emitting any
    // visible text. A budget near that truncates it mid-thought and returns an empty string —
    // which is what made this gate a coin flip at 32 and at 128.
    expect(CHAT_OUTPUT_BUDGET_TOKENS).toBeGreaterThan(512);
  });
});
