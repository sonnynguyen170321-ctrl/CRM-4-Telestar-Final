/**
 * `npm run agent -- <command>`
 *
 * One CLI for the agent control plane, rather than a dozen unrelated npm scripts nobody can
 * enumerate. Every subcommand supports `--json` so an agent can consume the result without
 * parsing human prose.
 *
 * Every command here is implemented. A subcommand that silently does nothing, or prints a
 * placeholder, is worse than one that does not exist — an agent will believe it ran.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { allFacts } from './facts';
import { capabilities, renderCapabilities } from './doctor';
import { compile, compileFromDiff, renderBrief } from './brief';
import { analyze, changedPaths, renderImpact } from './impact';
import { audit, auditExitCode, renderAudit } from './contextAudit';
import { runChecks, renderChecks, checksExitCode } from './check';
import { auditSkillFreshness, renderFreshness, freshnessExitCode } from './knowledgeAudit';
import { recordBrief, recordUsage, sessionRoi, staticRoi, renderRoi } from './roi';

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

  // Recorded so `agent roi` can later compare what was recommended against what was read.
  // Gitignored and task-scoped; the id is echoed so an agent can report actuals against it.
  const briefId = Date.now().toString(36);
  recordBrief(briefId, brief.paths, brief.skills.map((s) => s.id));

  out(`${renderBrief(brief)}\n\nbrief id: ${briefId}`, { command: 'brief', briefId, ...brief });
  return 0;
}

function runRoi(): number {
  const recordFlag = argv.indexOf('--record');
  if (recordFlag !== -1) {
    const id = argv[recordFlag + 1];
    const usedFlag = argv.indexOf('--used');
    const used = usedFlag === -1 ? [] : (argv[usedFlag + 1] ?? '').split(',').filter(Boolean);
    const ok = recordUsage(id, used);
    out(
      ok ? `Recorded ${used.length} used skill(s) for brief ${id}.` : `No brief ${id} in .agent/state/.`,
      { command: 'roi', mode: 'record', id, used, ok },
    );
    return ok ? 0 : 1;
  }

  const windowFlag = argv.indexOf('--commits');
  const commits = windowFlag === -1 ? 40 : Number(argv[windowFlag + 1]) || 40;
  const session = sessionRoi();
  const staticPart = staticRoi(commits);
  out(renderRoi(session, staticPart), { command: 'roi', session, static: staticPart });
  // A report, not a gate: rare knowledge is not waste, and an unknown ratio is not a failure.
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

async function runProjectChecks(): Promise<number> {
  const results = await runChecks();
  out(renderChecks(results), { command: 'check', results });
  return checksExitCode(results);
}

const HELP = `Telestar agent control plane

  npm run agent -- <command> [--json]

Commands
  facts            Regenerate .agent/generated/** from source        (--check to verify only)
  doctor           Report what this machine can actually run
  brief            Compile minimum sufficient context for a task
  impact           Classify a change: domains, risk, tests
  context-audit    Enforce the startup context budget
  check            Project-truth CI gates
  knowledge-audit  Which skills have had their sources move underneath them
  roi              Context ROI: skill selection frequency, routing gaps, loaded-vs-used

ROI
  --commits <n>    Replay routing over the last n commits (default 40)
  --record <id> --used <a,b>   Record which recommended skills a session actually read

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
      code = await runProjectChecks();
      break;
    case 'roi':
      code = runRoi();
      break;
    case 'knowledge-audit': {
      const findings = auditSkillFreshness();
      out(renderFreshness(findings), { command: 'knowledge-audit', findings });
      code = freshnessExitCode();
      break;
    }
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
