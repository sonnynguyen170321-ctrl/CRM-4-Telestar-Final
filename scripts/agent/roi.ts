/**
 * Context ROI (§XXI, §IX, §L).
 *
 * The metric that matters is *useful context / loaded context*. Two halves, measured
 * differently because only one of them can be known without an agent reporting back.
 *
 * **Static half — what routing would have done.** Replay `agent impact` over recent commits.
 * That is history the repository already has, and it answers questions no session log can:
 * which skills are selected often enough to be worth their token cost, which are never
 * selected at all, and which domains see churn with no skill covering them.
 *
 * **Session half — what was actually used.** `agent brief` records what it recommended;
 * an agent that finishes a task records what it actually read. The gap between the two is the
 * §XXI pattern "loaded 8 skills but used 2", and nothing except the agent can close it.
 *
 * Rare knowledge is not waste (§IX). A disaster-recovery skill selected twice a year is
 * working as intended, so this reports rather than prunes: `never selected` is a prompt to
 * look, not a verdict.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { analyze } from './impact';
import { skills as registrySkills } from './registry';

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, '.agent', 'state');

// ── session half ─────────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  recommended: string[];
  used?: string[];
  paths: string[];
}

function statePath(id: string): string {
  return path.join(STATE_DIR, `brief-${id}.json`);
}

/** Called by `agent brief`. Gitignored, and dies with the task (§XVIII). */
export function recordBrief(id: string, paths: string[], recommended: string[]): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(id), JSON.stringify({ id, paths, recommended } satisfies SessionRecord, null, 2));
}

/** Called by an agent when a task finishes: which of the recommended skills it actually read. */
export function recordUsage(id: string, used: string[]): boolean {
  const file = statePath(id);
  if (!existsSync(file)) return false;
  const record = JSON.parse(readFileSync(file, 'utf8')) as SessionRecord;
  writeFileSync(file, JSON.stringify({ ...record, used }, null, 2));
  return true;
}

export interface SessionRoi {
  sessions: number;
  withUsage: number;
  recommended: number;
  used: number;
  ratio: number | null;
  overloaded: Array<{ id: string; recommended: string[]; used: string[] }>;
}

export function sessionRoi(): SessionRoi {
  let records: SessionRecord[] = [];
  try {
    records = readdirSync(STATE_DIR)
      .filter((f) => f.startsWith('brief-') && f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(path.join(STATE_DIR, f), 'utf8')) as SessionRecord);
  } catch {
    records = [];
  }

  const withUsage = records.filter((r) => Array.isArray(r.used));
  const recommended = withUsage.reduce((n, r) => n + r.recommended.length, 0);
  const used = withUsage.reduce((n, r) => n + (r.used?.length ?? 0), 0);

  return {
    sessions: records.length,
    withUsage: withUsage.length,
    recommended,
    used,
    ratio: recommended > 0 ? used / recommended : null,
    overloaded: withUsage
      .filter((r) => r.recommended.length - (r.used?.length ?? 0) >= 2)
      .map((r) => ({ id: r.id, recommended: r.recommended, used: r.used ?? [] })),
  };
}

// ── static half ──────────────────────────────────────────────────────────────

export interface SkillFrequency {
  id: string;
  selections: number;
}

export interface StaticRoi {
  commits: number;
  classified: number;
  unclassifiedPaths: string[];
  frequency: SkillFrequency[];
  neverSelected: string[];
}

/** Replay routing over the last `n` commits. */
export function staticRoi(n = 40): StaticRoi {
  let shas: string[] = [];
  try {
    shas = execFileSync('git', ['log', '-n', String(n), '--format=%H'], { encoding: 'utf8', cwd: ROOT })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    shas = [];
  }

  const counts = new Map<string, number>();
  const unclassified = new Set<string>();
  let classified = 0;

  for (const sha of shas) {
    let files: string[] = [];
    try {
      files = execFileSync('git', ['show', '--name-only', '--format=', sha], {
        encoding: 'utf8',
        cwd: ROOT,
      })
        .trim()
        .split('\n')
        .filter(Boolean);
    } catch {
      continue;
    }
    if (files.length === 0) continue;

    const impact = analyze(files);
    classified += files.length - impact.unclassified.length;
    for (const file of impact.unclassified) unclassified.add(file);
    for (const skill of impact.skills) counts.set(skill, (counts.get(skill) ?? 0) + 1);
  }

  const frequency = [...counts.entries()]
    .map(([id, selections]) => ({ id, selections }))
    .sort((a, b) => b.selections - a.selections);

  const neverSelected = registrySkills()
    .filter((s) => s.status === 'active')
    .map((s) => s.id)
    .filter((id) => !counts.has(id));

  return {
    commits: shas.length,
    classified,
    unclassifiedPaths: [...unclassified].sort(),
    frequency,
    neverSelected,
  };
}

export function renderRoi(session: SessionRoi, staticPart: StaticRoi): string {
  const lines = ['Context ROI', ''];

  lines.push(`Routing replayed over ${staticPart.commits} commits`);
  if (staticPart.frequency.length === 0) {
    lines.push('  no skill was selected — either nothing changed, or routing is broken');
  } else {
    for (const entry of staticPart.frequency) {
      lines.push(`  ${String(entry.selections).padStart(4)}x  ${entry.id}`);
    }
  }

  if (staticPart.neverSelected.length > 0) {
    lines.push('');
    lines.push('Never selected in this window:');
    for (const id of staticPart.neverSelected) lines.push(`  ${id}`);
    lines.push('  Not automatically waste — rare disaster-recovery knowledge still earns its');
    lines.push('  place (§IX). Worth checking that its paths are mapped correctly.');
  }

  if (staticPart.unclassifiedPaths.length > 0) {
    lines.push('');
    lines.push(`${staticPart.unclassifiedPaths.length} path(s) matched no domain — routing gaps:`);
    for (const file of staticPart.unclassifiedPaths.slice(0, 15)) lines.push(`  ${file}`);
    if (staticPart.unclassifiedPaths.length > 15) {
      lines.push(`  … and ${staticPart.unclassifiedPaths.length - 15} more`);
    }
  }

  lines.push('');
  if (session.withUsage === 0) {
    lines.push(`Session usage: ${session.sessions} brief(s) recorded, none reporting what was used.`);
    lines.push('  An agent finishing a task records actuals with:');
    lines.push('    npm run agent -- roi --record <briefId> --used <skill,skill>');
    lines.push('  Until then the loaded-vs-used ratio is unknown, which is not the same as good.');
  } else {
    const pct = session.ratio === null ? 'n/a' : `${Math.round(session.ratio * 100)}%`;
    lines.push(
      `Session usage: ${session.used}/${session.recommended} recommended skills actually used (${pct}) ` +
        `across ${session.withUsage} session(s).`,
    );
    for (const over of session.overloaded) {
      lines.push(
        `  ${over.id}: loaded ${over.recommended.length}, used ${over.used.length} — ` +
          `[${over.recommended.filter((s) => !over.used.includes(s)).join(', ')}] went unread`,
      );
    }
  }

  return lines.join('\n');
}
