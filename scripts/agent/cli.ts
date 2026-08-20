/**
 * `npm run agent -- <command>`
 *
 * One CLI for the agent control plane, rather than a dozen unrelated npm scripts nobody can
 * enumerate. Every subcommand supports `--json` so an agent can consume the result without
 * parsing human prose.
 *
 * Commands land as their phase does; anything not yet implemented says so and exits non-zero
 * rather than pretending. A command that silently does nothing is worse than a missing one.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { allFacts } from './facts';
import { capabilities, renderCapabilities } from './doctor';
import { compile, compileFromDiff, renderBrief } from './brief';
import { analyze, changedPaths, renderImpact } from './impact';
import { audit, auditExitCode, renderAudit } from './contextAudit';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const json = argv.includes('--json');
const check = argv.includes('--check');

function out(human: string, data: unknown) {
  if (json) console.log(JSON.stringify(data, null, 2));
  else console.log(human);
}

async function runFacts(): Promise<number> {
  const facts = await allFacts();
  const written: string[] = [];
  const drifted: string[] = [];

  for (const fact of facts) {
    const target = path.join(ROOT, fact.file);
    const next = JSON.stringify(fact.data, null, 2) + '\n';

    if (check) {
      // Regeneration *is* the drift check: if the committed file differs from what the code
      // produces now, a fact has moved and something still claims the old one.
      const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
      if (current !== next) drifted.push(fact.file);
      continue;
    }

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, next);
    written.push(fact.file);
  }

  if (check) {
    out(
      drifted.length === 0
        ? `Generated facts match their sources (${facts.length} files).`
        : `Generated facts are stale:\n${drifted.map((f) => `  - ${f}`).join('\n')}\n\nRun: npm run agent -- facts`,
      { command: 'facts', mode: 'check', drifted, ok: drifted.length === 0 },
    );
    return drifted.length === 0 ? 0 : 1;
  }

  out(`Wrote ${written.length} generated fact files:\n${written.map((f) => `  ${f}`).join('\n')}`, {
    command: 'facts',
    written,
  });
  return 0;
}

async function runDoctor(): Promise<number> {
  const caps = await capabilities();
  out(renderCapabilities(caps), { command: 'doctor', capabilities: caps });
  // Deliberately exits 0 even with missing capabilities: this is a report about the machine,
  // not a verdict on the code. Exiting non-zero would make it useless in a shell that stops on
  // first failure, which is precisely where an agent wants to run it first.
  return 0;
}

/** `--paths a b c` up to the next flag, or `--diff <ref>`. */
function targetPaths(): string[] {
  const pathsFlag = argv.indexOf('--paths');
  if (pathsFlag !== -1) {
    const rest: string[] = [];
    for (let i = pathsFlag + 1; i < argv.length && !argv[i].startsWith('--'); i += 1) {
      rest.push(argv[i]);
    }
    return rest;
  }

  const diffFlag = argv.indexOf('--diff');
  const base = diffFlag !== -1 ? argv[diffFlag + 1] : undefined;
  return changedPaths(base ?? 'origin/main');
}

function runBrief(): number {
  const diffFlag = argv.indexOf('--diff');
  const brief =
    argv.includes('--paths') || diffFlag === -1 ? compile(targetPaths()) : compileFromDiff(argv[diffFlag + 1]);

  if (brief.paths.length === 0) {
    out('No changed paths. Pass --paths <files> or --diff <base>.', { command: 'brief', paths: [] });
    return 0;
  }
  out(renderBrief(brief), { command: 'brief', ...brief });
  return 0;
}

function runImpact(): number {
  const impact = analyze(targetPaths());
  if (impact.files.length === 0) {
    out('No changed paths.', { command: 'impact', files: [] });
    return 0;
  }
  out(renderImpact(impact), { command: 'impact', ...impact });
  return 0;
}

function runContextAudit(): number {
  const items = audit();
  out(renderAudit(items), { command: 'context-audit', items });
  return auditExitCode(items);
}

function notImplemented(name: string, phase: string): number {
  out(
    `\`agent ${name}\` is not implemented yet (${phase}).\nSee docs/agent-os/PLAN.md.`,
    { command: name, implemented: false, phase },
  );
  return 2;
}

const HELP = `Telestar agent control plane

  npm run agent -- <command> [--json]

Commands
  facts            Regenerate .agent/generated/** from source        (--check to verify only)
  doctor           Report what this machine can actually run
  brief            Compile minimum sufficient context for a task
  impact           Classify a change: domains, risk, tests
  context-audit    Enforce the startup context budget
  check            Project-truth CI gates                            (phase 6)
  knowledge-audit  Stale fingerprints, dead references               (phase 6)

Targeting
  --paths <a> <b>  Explicit paths
  --diff <base>    Everything changed since <base> (default origin/main)

Every command takes --json for machine consumption.`;

async function main(): Promise<void> {
  let code = 0;
  switch (command) {
    case 'facts':
      code = await runFacts();
      break;
    case 'doctor':
      code = await runDoctor();
      break;
    case 'brief':
      code = runBrief();
      break;
    case 'impact':
      code = runImpact();
      break;
    case 'context-audit':
      code = runContextAudit();
      break;
    case 'check':
    case 'knowledge-audit':
      code = notImplemented(command, 'phase 6');
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      code = 2;
  }
  process.exit(code);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
