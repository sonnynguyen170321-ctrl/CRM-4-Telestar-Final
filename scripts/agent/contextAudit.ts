/**
 * Context budget enforcement (§XX).
 *
 * Measures what an agent is forced to read before it reads the task, and fails when that
 * exceeds the budget. This is the check that stops the kernel regrowing: the previous
 * always-loaded surface reached ~79,300 tokens across 113 files, one correction at a time, and
 * nothing in the repository objected.
 *
 * Estimation is deliberately conservative and tokenizer-independent — bytes/4 for prose, which
 * runs slightly high for English and therefore errs toward failing early. §XX explicitly says
 * not to fail merely because a tokenizer differs.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** Bytes per token. High enough to be safe, low enough to still catch real growth. */
const BYTES_PER_TOKEN = 4;

export interface BudgetItem {
  label: string;
  files: string[];
  bytes: number;
  tokens: number;
  target: number;
  hardReview: number;
  status: 'ok' | 'review' | 'over';
}

function sizeOf(files: string[]): { bytes: number; present: string[] } {
  let bytes = 0;
  const present: string[] = [];
  for (const file of files) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) continue;
    bytes += statSync(full).size;
    present.push(file);
  }
  return { bytes, present };
}

function classify(tokens: number, target: number, hardReview: number): BudgetItem['status'] {
  if (tokens <= target) return 'ok';
  if (tokens <= hardReview) return 'review';
  return 'over';
}

/**
 * Files loaded on every turn regardless of task.
 *
 * Scoped `.claude/rules/*` are excluded by design — a rule carrying `paths:` frontmatter only
 * loads when a matching file is touched, so it is not startup cost. A rule *without*
 * frontmatter is startup cost, and is counted.
 */
function alwaysLoaded(): string[] {
  const files = ['AGENTS.md', 'CLAUDE.md'];
  const rulesDir = path.join(ROOT, '.claude', 'rules');
  if (!existsSync(rulesDir)) return files;

  for (const entry of readdirSync(rulesDir)) {
    if (!entry.endsWith('.md')) continue;
    const full = path.join(rulesDir, entry);
    if (statSync(full).isDirectory()) continue;
    const head = readFileSync(full, 'utf8').slice(0, 400);
    const scoped = /^---[\s\S]*?\bpaths:/.test(head);
    if (!scoped) files.push(`.claude/rules/${entry}`);
  }
  return files;
}

export function audit(): BudgetItem[] {
  const items: BudgetItem[] = [];

  const startup = sizeOf(alwaysLoaded());
  items.push({
    label: 'startup universal context',
    files: startup.present,
    bytes: startup.bytes,
    tokens: Math.round(startup.bytes / BYTES_PER_TOKEN),
    target: 2000,
    hardReview: 3000,
    status: classify(Math.round(startup.bytes / BYTES_PER_TOKEN), 2000, 3000),
  });

  const skillsDir = path.join(ROOT, '.agent', 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const skillFile = path.join(skillsDir, entry, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const bytes = statSync(skillFile).size;
      const tokens = Math.round(bytes / BYTES_PER_TOKEN);
      items.push({
        label: `skill: ${entry}`,
        files: [`.agent/skills/${entry}/SKILL.md`],
        bytes,
        tokens,
        target: 800,
        hardReview: 1200,
        status: classify(tokens, 800, 1200),
      });
    }
  }

  return items;
}

export function renderAudit(items: BudgetItem[]): string {
  const lines = ['Context budget', ''];
  for (const item of items) {
    const mark = item.status === 'ok' ? 'ok  ' : item.status === 'review' ? 'REVIEW' : 'OVER';
    lines.push(
      `  ${mark.padEnd(6)} ${item.label.padEnd(28)} ${String(item.tokens).padStart(6)} tokens ` +
        `(target ${item.target}, hard review ${item.hardReview})`,
    );
    if (item.status !== 'ok') {
      for (const file of item.files) lines.push(`         ${file}`);
    }
  }

  const over = items.filter((i) => i.status === 'over');
  if (over.length > 0) {
    lines.push('');
    lines.push('Over the hard review threshold. Options, in order of preference:');
    lines.push('  1. Move the content to a scoped rule or a skill so it loads on demand.');
    lines.push('  2. Generate it, if it is a fact rather than an explanation.');
    lines.push('  3. Delete it, if nothing reads it.');
    lines.push('Appending it to the kernel is not an option — that is the failure mode.');
  }
  return lines.join('\n');
}

/** Non-zero only when something is past its hard-review threshold. */
export function auditExitCode(items: BudgetItem[]): number {
  return items.some((i) => i.status === 'over') ? 1 : 0;
}
