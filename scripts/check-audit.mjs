#!/usr/bin/env node
/**
 * The dependency-vulnerability gate: `npm audit` at high and above, with one narrow escape hatch.
 *
 * This replaced a bare `npm audit --audit-level=high`, and the reason is a property of that command:
 * it has no way to say "known, looked at, nothing to do yet". On 2026-10-03 every pull request went
 * red on GHSA-vfj7-8cjw-p6xm — `braces` <= 3.0.3, where 3.0.3 is the latest version published —
 * reached only through `eslint-config-next` → `fast-glob` → `micromatch`, a lint-time chain that
 * never runs in production. With no fixed version to move to, the gate could only be bypassed or
 * deleted, and the workflow's own comment records where that road ends.
 *
 * The rules, so the hatch cannot become a hole:
 *
 *   1. **Production dependencies get no exceptions.** Any high/critical advisory in the tree npm
 *      installs without dev dependencies fails, whatever the exception file says.
 *   2. **A dev-only advisory fails unless it is listed** in `.github/audit-exceptions.json` with the
 *      package, a reason, and an expiry date.
 *   3. **Exceptions expire.** A past date fails the gate, and so does a date more than
 *      `MAX_EXCEPTION_DAYS` out — someone has to look again, which is the whole point of the gate.
 *   4. **A stale exception fails too.** An entry for an advisory that is no longer reported is
 *      removed rather than left to excuse something later.
 *
 *   node scripts/check-audit.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTIONS_FILE = join(ROOT, '.github', 'audit-exceptions.json');
const MAX_EXCEPTION_DAYS = 45;
const BLOCKING = new Set(['high', 'critical']);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function audit(extraArgs) {
  let stdout;
  try {
    stdout = execFileSync(npm, ['audit', '--json', ...extraArgs], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
  } catch (error) {
    // `npm audit` exits non-zero whenever it finds anything; the report is still on stdout.
    stdout = error.stdout;
    if (!stdout) throw error;
  }
  return JSON.parse(stdout);
}

/** Every blocking advisory in a report, as { advisory, package, severity, title }. */
function blockingAdvisories(report) {
  const found = new Map();
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const advisory = String(via.url ?? '').split('/').pop() || String(via.source);
      found.set(`${advisory}:${via.name ?? name}`, {
        advisory,
        package: via.name ?? name,
        severity: via.severity,
        title: via.title,
      });
    }
  }
  return [...found.values()];
}

function loadExceptions() {
  if (!existsSync(EXCEPTIONS_FILE)) return [];
  const parsed = JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8'));
  return Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
}

function daysUntil(isoDate) {
  return Math.floor((new Date(`${isoDate}T23:59:59Z`).getTime() - Date.now()) / 86_400_000);
}

const problems = [];
const prod = blockingAdvisories(audit(['--omit=dev']));
const all = blockingAdvisories(audit([]));
const prodKeys = new Set(prod.map((a) => `${a.advisory}:${a.package}`));
const devOnly = all.filter((a) => !prodKeys.has(`${a.advisory}:${a.package}`));
const exceptions = loadExceptions();

for (const a of prod) {
  problems.push(`PRODUCTION ${a.severity}: ${a.package} — ${a.advisory} ${a.title} (no exception can cover a production dependency)`);
}

for (const a of devOnly) {
  const exception = exceptions.find((e) => e.advisory === a.advisory && e.package === a.package);
  if (!exception) {
    problems.push(`dev-only ${a.severity}: ${a.package} — ${a.advisory} ${a.title} (fix it, or add a dated entry to .github/audit-exceptions.json)`);
    continue;
  }
  if (!exception.reason || !exception.expires) {
    problems.push(`exception for ${a.advisory} needs both "reason" and "expires"`);
    continue;
  }
  const days = daysUntil(exception.expires);
  if (Number.isNaN(days) || days < 0) {
    problems.push(`exception for ${a.advisory} (${a.package}) expired on ${exception.expires} — look again: is there a fix now?`);
  } else if (days > MAX_EXCEPTION_DAYS) {
    problems.push(`exception for ${a.advisory} runs ${days} days; the limit is ${MAX_EXCEPTION_DAYS}`);
  } else {
    console.log(`excepted (dev-only, expires ${exception.expires}): ${a.package} — ${a.advisory} ${a.title}`);
  }
}

const reported = new Set(all.map((a) => `${a.advisory}:${a.package}`));
for (const e of exceptions) {
  if (!reported.has(`${e.advisory}:${e.package}`)) {
    problems.push(`stale exception: ${e.advisory} (${e.package}) is no longer reported — remove it`);
  }
}

if (problems.length) {
  console.error(`Dependency audit failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Dependency audit OK — production: 0 high/critical; dev-only: ${devOnly.length} excepted.`);
