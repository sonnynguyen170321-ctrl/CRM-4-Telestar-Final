import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * AI must be optional (Revenue AI Phase 1, ARCHITECTURE invariant 2).
 *
 * "If every AI provider is unavailable, the core CRM still operates normally."
 *
 * This is true today, but only because nothing in the CRM happens to import `lib/ai`.
 * A property held by accident is one a single import statement removes, and it would be
 * removed silently — the CRM would keep passing its own tests right up until a provider
 * outage took sequence execution down with it.
 *
 * So the guarantee is asserted structurally rather than behaviourally. A behavioural test
 * ("unset the API keys, check sequences still run") only proves the paths it happens to
 * exercise; a dependency assertion proves it for every path at once, including the ones
 * nobody has written yet.
 */

const ROOT = process.cwd();

/** Where AI code is allowed to live or be imported from. */
const AI_ALLOWED_PREFIXES = [
  path.join('lib', 'ai'),
  path.join('lib', 'agent'),
  path.join('lib', 'research'),
  path.join('app', 'api', 'ai'),
  path.join('components', 'AiAssistant.tsx'),
  path.join('tests', 'ai-'),
];

/** Directories that make up the core CRM — the parts that must survive an AI outage. */
const CORE_DIRS = ['lib', 'workers', 'app/api', 'components', 'context'];

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

function relative(file: string): string {
  return path.relative(ROOT, file);
}

function isAiOwned(rel: string): boolean {
  return AI_ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

/** Remove block and line comments so prose about a helper is not mistaken for a call to it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Matches `from '@/lib/ai/...'`, `from './ai/...'`, `require('@/lib/ai/...')`. */
const AI_IMPORT = /(?:from\s+|require\()\s*['"]([^'"]*\/ai\/[^'"]*|@\/lib\/ai[^'"]*)['"]/g;

describe('AI is an optional layer, not a CRM dependency', () => {
  const coreFiles = CORE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)))
    .map(relative)
    .filter((rel) => !isAiOwned(rel));

  it('finds the core CRM files to check (guards against a broken walker)', () => {
    // A walker that silently returns nothing would make every assertion below vacuous.
    expect(coreFiles.length).toBeGreaterThan(200);
  });

  it('no core CRM module imports lib/ai', () => {
    const offenders: string[] = [];

    for (const rel of coreFiles) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      for (const match of source.matchAll(AI_IMPORT)) {
        offenders.push(`${rel} imports ${match[1]}`);
      }
    }

    // If this fails, the CRM has taken a dependency on the AI layer. That is not a lint
    // preference — it means a provider outage can now reach sequence execution, reply
    // processing or sending. Move the logic behind a domain service instead.
    expect(offenders).toEqual([]);
  });

  it('the automation engine and its workers are free of AI imports', () => {
    const automationFiles = [
      ...walk(path.join(ROOT, 'lib', 'automation')),
      ...walk(path.join(ROOT, 'lib', 'sequences')),
      ...walk(path.join(ROOT, 'workers')),
    ].map(relative);

    expect(automationFiles.length).toBeGreaterThan(5);

    const offenders = automationFiles.filter((rel) => {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      return AI_IMPORT.test(source) || /\bstreamChat\b|\bgroq-sdk\b|@google\/generative-ai/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('no core module imports a provider SDK directly', () => {
    const offenders: string[] = [];

    for (const rel of coreFiles) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      if (/from\s+['"](groq-sdk|@google\/generative-ai)['"]/.test(source)) {
        offenders.push(rel);
      }
    }

    // Routing through lib/ai is what makes the boundary auditable. A direct SDK import
    // in a CRM module reintroduces the coupling this file exists to prevent.
    expect(offenders).toEqual([]);
  });

  it('no Client Component imports a server-side AI module', () => {
    // `next build` is the only gate that catches this, and it catches it as a wall of
    // "Can't resolve 'async_hooks' / 'dns' / 'net'" — tsc and vitest both pass, because
    // the problem is bundling, not types. provider.ts and usage.ts reach the database;
    // tools.ts calls internal APIs. A "use client" file may import model constants from
    // lib/ai/models.ts, which is import-free for exactly this reason.
    const SERVER_ONLY_AI = [
      '@/lib/ai/provider',
      '@/lib/ai/usage',
      '@/lib/ai/tools',
      // Prisma-backed: reads AutonomyPolicy. lib/agent/capabilities.ts and
      // toolCapabilities.ts are import-free vocabulary and stay client-safe.
      '@/lib/agent/authorization',
    ];
    const offenders: string[] = [];

    const clientFiles = [
      ...walk(path.join(ROOT, 'components')),
      ...walk(path.join(ROOT, 'app')),
      ...walk(path.join(ROOT, 'context')),
    ].map(relative);

    for (const rel of clientFiles) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      if (!/^\s*['"]use client['"]/m.test(source)) continue;
      for (const mod of SERVER_ONLY_AI) {
        if (source.includes(`'${mod}'`) || source.includes(`"${mod}"`)) {
          offenders.push(`${rel} imports ${mod}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the client-safe model module stays import-free', () => {
    // Its whole purpose is having no dependencies. One import and the boundary is gone.
    const source = readFileSync(path.join(ROOT, 'lib', 'ai', 'models.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('AI usage recording is confined to the AI layer', () => {
    const offenders: string[] = [];

    for (const rel of coreFiles) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      if (/\brecordAiCall\b|from\s+['"][^'"]*ai\/usage['"]/.test(source)) {
        offenders.push(rel);
      }
    }

    // usage.ts records AI spend. It is not a general metrics facility, and a CRM module
    // reaching for it is a CRM module that has grown an AI dependency.
    expect(offenders).toEqual([]);
  });

  it('the AI layer does not import SIP, Twilio, or telephony calling logic', () => {
    const aiFiles = [
      ...walk(path.join(ROOT, 'lib', 'ai')),
      ...walk(path.join(ROOT, 'lib', 'agent')),
    ].map(relative);

    const offenders: string[] = [];
    const TELEPHONY_IMPORTS = /from\s+['"](twilio|@twilio\/.*|sip|sip\.js|.*telephony.*)['"]/i;
    const TELEPHONY_WORDS = /\b(Twilio|SIP|Dial|PlaceCall|TelephonyClient)\b/i;

    for (const rel of aiFiles) {
      const source = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
      if (TELEPHONY_IMPORTS.test(source) || (TELEPHONY_WORDS.test(source) && !/tests\\ai-optional\.test\.ts/.test(rel))) {
        // Exclude the test file itself if the walker included it
        offenders.push(rel);
      }
    }

    // AI is restricted from initiating calls (Phase 5). This structural check ensures
    // the AI layer physically cannot execute telephony because it holds no imports for it.
    expect(offenders).toEqual([]);
  });
});
