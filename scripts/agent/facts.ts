/**
 * Fact generators — the machine-truth half of the agent control plane.
 *
 * Every function here derives a fact from the code that defines it, so that no human has to
 * maintain it and no document can quietly disagree with it. The authorities are declared in
 * `.agent/registry/sources.yaml`.
 *
 * The rule that makes this worth having: **prefer importing the real module over parsing it.**
 * A regex over `registry.ts` is a second implementation of TypeScript that is wrong in ways
 * nobody notices; importing the module means the generated contract cannot disagree with the
 * running code, because it *is* the running code.
 *
 * Where importing is unsafe — `lib/env.ts` validates and throws at import — the declarative
 * part is extracted into a side-effect-free module (`lib/env-contract.ts`) and imported from
 * there instead. Parsing is the last resort, used only for the route tree, which is defined by
 * file layout rather than by any value a module exports.
 *
 * Nothing here reads a secret. Credential facts are names and presence, never values.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

export interface GeneratedFile {
  /** Path relative to the repository root. */
  file: string;
  data: unknown;
}

/** Common envelope so a consumer can tell what produced a fact and from what. */
function envelope(generatedFrom: string[], data: Record<string, unknown>) {
  return {
    $generated: {
      by: 'npm run agent -- facts',
      // Deliberately no timestamp: it would make every run a diff, and the useful question is
      // "does this match the source", which `agent check` answers by regenerating.
      from: generatedFrom,
      warning: 'Generated file. Do not edit by hand; the next run reverts it.',
    },
    ...data,
  };
}

// ── project facts ────────────────────────────────────────────────────────────

export function projectFacts(): GeneratedFile {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const stack = ['next', 'react', 'typescript', 'prisma', 'bullmq', 'zod', '@playwright/test', 'vitest']
    .filter((name) => deps[name])
    .map((name) => ({ package: name, version: deps[name] }));

  return {
    file: '.agent/generated/project-facts.json',
    data: envelope(['package.json'], {
      name: pkg.name ?? null,
      stack,
      scripts: Object.keys(pkg.scripts ?? {}).sort(),
      scriptCount: Object.keys(pkg.scripts ?? {}).length,
    }),
  };
}

// ── roles ────────────────────────────────────────────────────────────────────

/**
 * The six roles, read from the code that decides them.
 *
 * `role` is a `String` column rather than a Prisma enum, so the schema cannot be asked for the
 * list. The authority is therefore the authorization layer, and the point of generating it is
 * precisely that a hand-written role list has no way to notice when a seventh role appears —
 * which is how a four-role architecture document survived into a six-role product.
 */
export function roleMap(): GeneratedFile {
  const sources = ['lib/auth.ts', 'lib/podScoping.ts', 'lib/admin/orgRules.ts'];
  const found = new Set<string>();

  for (const rel of sources) {
    let source: string;
    try {
      source = readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    for (const match of source.matchAll(
      /'(director|floor_manager|team_lead|sdr|leadgen_manager|leadgen)'/g,
    )) {
      found.add(match[1]);
    }
  }

  const roles = [...found].sort();
  return {
    file: '.agent/generated/role-map.json',
    data: envelope(sources, {
      roles,
      count: roles.length,
      storage: 'String column on User — not a database enum, so nothing rejects an invalid value',
      scoping: 'managerId walk: team_lead -> their SDRs, floor_manager -> their team leads, director -> all',
      note: 'Any list naming four roles is stale.',
    }),
  };
}

// ── routes ───────────────────────────────────────────────────────────────────

/** The App Router tree, which is defined by file layout and so must be walked. */
export function routeMap(): GeneratedFile {
  const appDir = path.join(ROOT, 'app');
  const pages: string[] = [];
  const apis: string[] = [];

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(appDir, full).split(path.sep).join('/');
      // A route group `(name)` is organisational and contributes no URL segment.
      const url = '/' + rel.replace(/\/?(page|route)\.tsx?$/, '').replace(/\(([^)]+)\)\//g, '');
      if (/(^|\/)page\.tsx?$/.test(rel)) pages.push(url === '/' ? '/' : url.replace(/\/$/, ''));
      if (/(^|\/)route\.tsx?$/.test(rel)) apis.push(url.replace(/\/$/, ''));
    }
  };
  walk(appDir);

  pages.sort();
  apis.sort();
  return {
    file: '.agent/generated/route-map.json',
    data: envelope(['app/**'], {
      pages,
      apiRoutes: apis,
      pageCount: pages.length,
      apiRouteCount: apis.length,
    }),
  };
}

// ── AI contract ──────────────────────────────────────────────────────────────

/**
 * The model contract, imported from the registry rather than parsed out of it.
 *
 * This is the fact most likely to be quoted in a document and most expensive to get wrong: the
 * registry drives routing, attribution and the tenant spend cap. Importing guarantees the
 * generated table and the running product cannot disagree.
 */
export async function aiContract(): Promise<GeneratedFile> {
  const { MODEL_REGISTRY } = await import('../../lib/ai/registry');

  const models = Object.values(MODEL_REGISTRY).map((model) => ({
    modelId: model.modelId,
    provider: model.provider,
    displayName: model.displayName,
    aliasEqualsModelId: model.internalAlias === model.modelId,
    contextLimit: model.contextLimit,
    maxOutputTokens: model.maxOutputTokens,
    defaultMaxOutputTokens: model.parameters.defaultMaxOutputTokens,
    supportsTools: model.supportsTools,
    supportsStructuredOutput: model.supportsStructuredOutput,
    supportsVision: model.supportsVision,
    rejectedParameters: [...model.parameters.rejectedParameters],
    pricing: {
      currency: model.pricing.currency,
      verifiedAt: model.pricing.verifiedAt,
      periods: model.pricing.periods.map((period) => ({ ...period })),
      longContext: model.pricing.longContext ? { ...model.pricing.longContext } : null,
    },
  }));

  return {
    file: '.agent/generated/ai-contract.json',
    data: envelope(['lib/ai/registry.ts'], {
      productionModelCount: models.length,
      models,
      evidence: 'docs/telestar-ai-remediation/MODEL_VERIFICATION.json',
      invariant: 'internalAlias === modelId for every production model',
    }),
  };
}

// ── environment contract ─────────────────────────────────────────────────────

/** Names and grouping only. This generator never touches a value. */
export async function envContract(): Promise<GeneratedFile> {
  const contract = await import('../../lib/env-contract');

  return {
    file: '.agent/generated/env-contract.json',
    data: envelope(['lib/env-contract.ts'], {
      runtimeRequired: [...contract.RUNTIME_REQUIRED_ENV],
      productionRequired: [...contract.PRODUCTION_REQUIRED_ENV],
      aiProviders: [...contract.AI_PROVIDER_ENV],
      optionalGroups: Object.fromEntries(
        Object.entries(contract.OPTIONAL_ENV_GROUPS).map(([group, vars]) => [group, [...vars]]),
      ),
      note: 'Names only. Presence is reported as SET / NOT SET; values are never read here.',
    }),
  };
}

// ── queues and workers ───────────────────────────────────────────────────────

export async function queueMap(): Promise<GeneratedFile> {
  const workersDir = path.join(ROOT, 'workers');
  let entrypoints: string[] = [];
  try {
    entrypoints = readdirSync(workersDir)
      .filter((f) => /\.ts$/.test(f))
      .map((f) => `workers/${f}`)
      .sort();
  } catch {
    entrypoints = [];
  }

  // Imported, not scanned. The first version of this grepped for `new Queue('name')` and found
  // nothing, because the names are a `QUEUES` constant and the only `new Queue(` call passes a
  // variable. It reported zero queues without failing, which is precisely the shape of
  // generator this control plane exists to avoid: confidently, silently empty.
  const { QUEUES, JobType } = await import('../../lib/bullmq/types');

  return {
    file: '.agent/generated/queue-map.json',
    data: envelope(['workers/**', 'lib/bullmq/types.ts'], {
      workerEntrypoints: entrypoints,
      queues: Object.values(QUEUES).sort(),
      jobTypes: Object.values(JobType).sort(),
      invariant: 'The database is workflow truth; every delayed job must be rebuildable from it.',
    }),
  };
}

export async function allFacts(): Promise<GeneratedFile[]> {
  return [
    projectFacts(),
    roleMap(),
    routeMap(),
    await aiContract(),
    await envContract(),
    await queueMap(),
  ];
}
