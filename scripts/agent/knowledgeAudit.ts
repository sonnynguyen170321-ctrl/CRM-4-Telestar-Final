/**
 * Knowledge freshness (§XI, §XII).
 *
 * A skill describes source it does not control. When that source moves and the skill does not,
 * the skill is still loaded, still authoritative-looking, and quietly describing something
 * that no longer exists — the exact failure that produced a four-role architecture document
 * for a six-role product.
 *
 * This does not try to decide whether a skill is *wrong*; nothing cheap can. It reports which
 * knowledge artifacts have had their sources change underneath them since they were last
 * touched, so a human or agent can look. **REVIEW REQUIRED is not a failure** — it is a queue.
 *
 * Freshness comes from git commit dates rather than filesystem mtimes, because a checkout
 * gives every file the same mtime and would report either everything or nothing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { skills, type SkillEntry } from './registry';

const ROOT = process.cwd();

export interface FreshnessFinding {
  artifact: string;
  lastTouched: string | null;
  staleSources: Array<{ path: string; lastChanged: string }>;
}

/** Unix timestamp of the last commit touching a path, or null when git knows nothing. */
function lastCommitEpoch(target: string): number | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', target], {
      encoding: 'utf8',
      cwd: ROOT,
    }).trim();
    return out.length > 0 ? Number(out) : null;
  } catch {
    return null;
  }
}

function iso(epoch: number | null): string | null {
  return epoch === null ? null : new Date(epoch * 1000).toISOString().slice(0, 10);
}

/**
 * Expand a source glob to the paths git can be asked about.
 *
 * git's own pathspec handles the wildcards, so the glob is passed through mostly intact; only
 * the leading literal directory is checked, to avoid asking about a path that never existed.
 */
function sourceTarget(glob: string): string | null {
  const wildcard = glob.indexOf('*');
  if (wildcard === -1) return existsSync(path.join(ROOT, glob)) ? glob : null;
  const prefix = glob.slice(0, wildcard);
  const dir = prefix.endsWith('/') ? prefix.slice(0, -1) : path.dirname(prefix);
  if (dir.length === 0 || !existsSync(path.join(ROOT, dir))) return null;
  return glob;
}

export function auditSkillFreshness(entries: SkillEntry[] = skills()): FreshnessFinding[] {
  const findings: FreshnessFinding[] = [];

  for (const skill of entries) {
    if (skill.status !== 'active') continue;
    const file = path.join('.agent', 'skills', skill.id, 'SKILL.md');
    if (!existsSync(path.join(ROOT, file))) continue;

    const touched = lastCommitEpoch(file);
    if (touched === null) continue; // never committed — nothing to compare against yet

    const stale: FreshnessFinding['staleSources'] = [];
    for (const glob of skill.sources ?? []) {
      const target = sourceTarget(glob);
      if (!target) continue;
      const changed = lastCommitEpoch(target);
      if (changed !== null && changed > touched) {
        stale.push({ path: glob, lastChanged: iso(changed) as string });
      }
    }

    if (stale.length > 0) {
      findings.push({ artifact: file, lastTouched: iso(touched), staleSources: stale });
    }
  }

  return findings;
}

export function renderFreshness(findings: FreshnessFinding[]): string {
  if (findings.length === 0) {
    return 'Knowledge freshness\n\n  ok   every active skill is newer than the sources it describes';
  }

  const lines = ['Knowledge freshness', '', `  ${findings.length} artifact(s) REVIEW REQUIRED`, ''];
  for (const finding of findings) {
    lines.push(`  ${finding.artifact}  (last touched ${finding.lastTouched})`);
    for (const source of finding.staleSources) {
      lines.push(`      ${source.path} changed ${source.lastChanged}`);
    }
  }
  lines.push('');
  lines.push('REVIEW REQUIRED is a queue, not a failure. Read the skill against its sources;');
  lines.push('if it is still correct, touching it records that it was checked.');
  return lines.join('\n');
}

/**
 * Always zero.
 *
 * Deliberate: source moving under a skill is normal and constant, and a gate that goes red on
 * every ordinary commit is a gate people route around. `agent check` is the gate; this is the
 * report.
 */
export function freshnessExitCode(): number {
  return 0;
}
