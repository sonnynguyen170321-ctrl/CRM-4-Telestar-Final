import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  ENV_FILES,
  parseEnvFile,
  mergeEnvFiles,
  TYPECHECK_ARGS,
  TYPECHECK_NODE_OPTIONS,
  classifyTypecheckResult,
  PRISMA_MIGRATE_STATUS_ARGS,
  summarizeDependencyProblems,
  evaluateStrictEmailSafety,
} from '../scripts/doctor-core.mjs';

/**
 * Doctor is the first command `CLAUDE.md` tells every agent to run, and it describes itself as
 * reporting "what this machine can actually run". On this machine it reported three things that
 * were not true, and each one trained the reader to discount it:
 *
 *   1. `TypeScript  errors` on a tree with zero type errors. `npx tsc` cannot run in a checkout
 *      whose path contains an `&` — cmd.exe splits on it, and npx resolved a `typescript` folder
 *      under `Desktop` that does not exist. Doctor printed the word "errors" and threw away the
 *      subprocess output, so a broken invocation was indistinguishable from a real failure.
 *
 *   2. `Required env vars missing: DATABASE_URL, ...` and `NOT READY` while both the application
 *      and the certification ladder started fine, because Doctor read `.env` alone and this
 *      machine is configured through `.env.local` — which is what Next.js and the ladder's own
 *      `loadEnv.mjs` read.
 *
 *   3. `Email dry-run  DISABLED — live email sending is active` for an UNSET variable.
 *      `lib/emailSafety.ts` fails closed: unset means dry-run on. The warning stated the
 *      opposite of the running code.
 *
 * The third is the one that could have caused harm rather than just noise: an operator reading
 * "unset means live sending" could reasonably conclude the default fails open and "fix" the
 * default — reintroducing exactly the bug that file's header says was removed.
 */

describe('env files Doctor reads', () => {
  it('reads .env.local before .env, matching Next.js and the ladder', () => {
    expect(ENV_FILES).toEqual(['.env.local', '.env']);
  });

  it('is the same list the certification ladder loads', () => {
    // Two sources of truth for "where configuration lives" is how this drifted in the first
    // place. If loadEnv.mjs grows a file, this test fails until Doctor grows it too.
    const loadEnv = readFileSync(
      join(process.cwd(), 'scripts', 'certification', 'lib', 'loadEnv.mjs'),
      'utf8',
    );
    const declared = loadEnv.match(/const files = \[([^\]]+)\]/)?.[1] ?? '';
    const parsed = declared.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    expect(parsed).toEqual([...ENV_FILES]);
  });

  it('doctor-env-check no longer hardcodes a single .env', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor-env-check.ts'), 'utf8');
    expect(source).toContain('ENV_FILES');
    expect(source).not.toContain("const envFilePath = '.env'");
  });

  it('the missing-configuration guard checks every file, not just .env', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).toContain('ENV_FILES.some((file) => existsSync(resolve(ROOT, file)))');
    expect(source).not.toContain("existsSync(resolve(ROOT, '.env'))");
  });
});

describe('mergeEnvFiles', () => {
  it('lets the inherited process environment win over every file', () => {
    const merged = mergeEnvFiles(
      { DATABASE_URL: 'from-process' },
      { '.env.local': { DATABASE_URL: 'from-local' }, '.env': { DATABASE_URL: 'from-env' } },
    );
    expect(merged.DATABASE_URL).toBe('from-process');
  });

  it('lets .env.local win over .env', () => {
    const merged = mergeEnvFiles(
      {},
      { '.env.local': { DATABASE_URL: 'from-local' }, '.env': { DATABASE_URL: 'from-env' } },
    );
    expect(merged.DATABASE_URL).toBe('from-local');
  });

  it('unions keys across files', () => {
    const merged = mergeEnvFiles({}, { '.env.local': { A: '1' }, '.env': { B: '2' } });
    expect(merged).toMatchObject({ A: '1', B: '2' });
  });

  it('treats an empty inherited value as absent', () => {
    // An exported-but-empty variable is not configuration.
    expect(mergeEnvFiles({ A: '' }, { '.env': { A: 'real' } }).A).toBe('real');
  });

  it('does not mutate the base environment', () => {
    const base = { A: '1' };
    mergeEnvFiles(base, { '.env': { B: '2' } });
    expect(base).toEqual({ A: '1' });
  });

  it('handles a file that is absent from the parsed map', () => {
    expect(mergeEnvFiles({}, {})).toEqual({});
  });
});

describe('typecheck invocation', () => {
  it('runs tsc through node rather than the npx shim', () => {
    // The `&` in this checkout's path makes `npx tsc` resolve a directory that does not exist.
    expect(TYPECHECK_ARGS[0]).toBe('node_modules/typescript/bin/tsc');
    expect(TYPECHECK_ARGS).toContain('--noEmit');
  });

  it('raises the heap, because the default one kills tsc on this program', () => {
    expect(TYPECHECK_NODE_OPTIONS).toContain('--max-old-space-size');
  });

  it('doctor.mjs no longer shells out to npx tsc', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).not.toContain("safeExecCode('npx tsc --noEmit')");
    expect(source).toContain('TYPECHECK_ARGS');
  });
});

describe('classifyTypecheckResult', () => {
  it('passes a clean run', () => {
    expect(classifyTypecheckResult({ ok: true })).toMatchObject({ ok: true, summary: 'pass' });
  });

  it('counts real type errors and says how many', () => {
    const detail = [
      "lib/auth.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "lib/auth.ts(19,9): error TS2551: Property 'x' does not exist.",
    ].join('\n');
    const verdict = classifyTypecheckResult({ ok: false, detail });
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toBe('2 type errors');
  });

  it('uses the singular for one error', () => {
    const detail = "a.ts(1,1): error TS1005: expected a semicolon.";
    expect(classifyTypecheckResult({ ok: false, detail }).summary).toBe('1 type error');
  });

  it('reports a failed invocation as such, not as type errors', () => {
    // The exact shape of failure this machine produced.
    const detail =
      "'...node_modules\\.bin\\' is not recognized as an internal or external command,\n" +
      'operable program or batch file.';
    const verdict = classifyTypecheckResult({ ok: false, detail });
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toBe('could not run tsc');
  });

  it('reports an out-of-memory abort as a failed invocation, not as type errors', () => {
    const detail =
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory';
    expect(classifyTypecheckResult({ ok: false, detail }).summary).toBe('could not run tsc');
  });

  it('carries the detail through so the operator can see what happened', () => {
    const detail = 'a.ts(1,1): error TS1005: something';
    expect(classifyTypecheckResult({ ok: false, detail }).detail).toBe(detail);
  });

  it('doctor prints that detail instead of the bare word "errors"', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).not.toContain("fail('TypeScript', 'errors')");
    expect(source).toContain('tscVerdict.detail.split');
  });
});

describe('parseEnvFile', () => {
  // doctor.mjs cannot import dotenv: checking whether dependencies installed is most of its job.
  it('parses plain assignments', () => {
    expect(parseEnvFile('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('strips matching quotes, which is how DATABASE_URL is written here', () => {
    expect(parseEnvFile('A="postgresql://h/db"')['A']).toBe('postgresql://h/db');
    expect(parseEnvFile("A='x'").A).toBe('x');
  });

  it('keeps an unmatched quote rather than truncating the value', () => {
    expect(parseEnvFile('A="x').A).toBe('"x');
  });

  it('ignores comments and blank lines', () => {
    expect(parseEnvFile('# note\n\nA=1\n')).toEqual({ A: '1' });
  });

  it('accepts an export prefix', () => {
    expect(parseEnvFile('export A=1')).toEqual({ A: '1' });
  });

  it('keeps = inside a value', () => {
    expect(parseEnvFile('A=a=b').A).toBe('a=b');
  });

  it('skips a line with no key', () => {
    expect(parseEnvFile('=novalue')).toEqual({});
  });

  it('survives empty and nullish input', () => {
    expect(parseEnvFile('')).toEqual({});
    expect(parseEnvFile(undefined)).toEqual({});
  });
});

describe('migration status invocation', () => {
  it('runs prisma through node rather than the npx shim', () => {
    expect(PRISMA_MIGRATE_STATUS_ARGS[0]).toBe('node_modules/prisma/build/index.js');
    expect(PRISMA_MIGRATE_STATUS_ARGS.slice(1)).toEqual(['migrate', 'status']);
  });

  it('doctor.mjs no longer shells out to npx prisma', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).not.toContain("safeExec('npx prisma migrate status')");
    expect(source).toContain('PRISMA_MIGRATE_STATUS_ARGS');
  });

  it('passes the env files to the prisma child, which does not inherit them otherwise', () => {
    // doctor-env-check.ts merges the files into ITS OWN process. Nothing propagates back, so
    // prisma failed with "Environment variable not found: DIRECT_URL" and doctor reported that
    // as "status check failed" — indistinguishable from a schema that is actually behind.
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).toContain('env: mergeEnvFiles(process.env, parsedEnvFiles)');
  });

  it('prints what prisma said when the check fails', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).toMatch(/migStatusResult\.stdout/);
  });
});

describe('summarizeDependencyProblems', () => {
  const tree = (dependencies: Record<string, unknown>, problems?: string[]) => ({
    name: 'root',
    ...(problems ? { problems } : {}),
    dependencies,
  });

  it('reports a clean tree as clean', () => {
    expect(summarizeDependencyProblems(JSON.stringify(tree({ a: {} })))).toEqual({
      parsed: true,
      problems: [],
    });
  });

  it('names the packages instead of saying "has problems"', () => {
    // The two this machine actually had. Hidden behind one generic line for weeks.
    const raw = JSON.stringify(
      tree(
        {
          nodemailer: {
            problems: ['invalid: nodemailer@9.0.5 C:\\Users\\x\\repo\\node_modules\\nodemailer'],
          },
          openai: { dependencies: { ws: { problems: ['invalid: ws@7.5.11 C:\\Users\\x\\repo\\node_modules\\ws'] } } },
        },
      ),
    );
    const result = summarizeDependencyProblems(raw);
    expect(result.parsed).toBe(true);
    expect(result.problems).toEqual(['invalid: nodemailer@9.0.5', 'invalid: ws@7.5.11']);
  });

  it('walks nested dependencies', () => {
    const raw = JSON.stringify(tree({ a: { dependencies: { b: { dependencies: { c: { problems: ['missing: c@1'] } } } } } }));
    expect(summarizeDependencyProblems(raw).problems).toEqual(['missing: c@1']);
  });

  it('collects problems on the root node too', () => {
    const raw = JSON.stringify(tree({}, ['extraneous: junk@1']));
    expect(summarizeDependencyProblems(raw).problems).toEqual(['extraneous: junk@1']);
  });

  it('deduplicates the same problem reported at several places in the tree', () => {
    const raw = JSON.stringify(
      tree({ a: { problems: ['invalid: ws@7.5.11'] }, b: { problems: ['invalid: ws@7.5.11'] } }),
    );
    expect(summarizeDependencyProblems(raw).problems).toEqual(['invalid: ws@7.5.11']);
  });

  it('reports unparsable output as unparsed, not as a clean tree', () => {
    // Absent evidence must never read as a pass. This is exactly what happened when the JSON
    // was passed through the credential sanitizer first and stopped being valid JSON.
    expect(summarizeDependencyProblems('npm error code ELSPROBLEMS')).toEqual({
      parsed: false,
      problems: [],
    });
    expect(summarizeDependencyProblems('')).toEqual({ parsed: false, problems: [] });
    expect(summarizeDependencyProblems('null')).toEqual({ parsed: false, problems: [] });
  });

  it('doctor reads npm ls stdout raw, because the sanitizer breaks the JSON', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).not.toContain("safeExecCode('npm ls --all --json')");
    expect(source).toContain('summarizeDependencyProblems(npmLsStdout)');
  });

  it('doctor treats a non-zero exit as normal and still reads the tree', () => {
    // `npm ls` exits 1 whenever it finds anything, so exit code alone says nothing about
    // whether the tree could be read.
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).toContain('npmLsStdout = err?.stdout');
  });
});

describe('email safety reporting tells the truth about unset variables', () => {
  it('still requires both variables to be set explicitly', () => {
    // The strict requirement is deliberate and is NOT being relaxed here.
    expect(evaluateStrictEmailSafety({}).ok).toBe(false);
    expect(
      evaluateStrictEmailSafety({ EMAIL_SEND_DRY_RUN: 'true', SEQUENCE_AUTOSEND_ENABLED: 'false' })
        .ok,
    ).toBe(true);
  });

  it('distinguishes unset from set-to-an-unsafe-value', () => {
    const unset = evaluateStrictEmailSafety({});
    expect(unset.dryRunSet).toBe(false);
    expect(unset.autosendSet).toBe(false);

    const unsafe = evaluateStrictEmailSafety({
      EMAIL_SEND_DRY_RUN: 'false',
      SEQUENCE_AUTOSEND_ENABLED: 'true',
    });
    expect(unsafe.dryRunSet).toBe(true);
    expect(unsafe.autosendSet).toBe(true);
    expect(unsafe.ok).toBe(false);
  });

  it('treats whitespace as unset', () => {
    expect(evaluateStrictEmailSafety({ EMAIL_SEND_DRY_RUN: '   ' }).dryRunSet).toBe(false);
  });

  it('does not claim live sending is active when the variable is merely unset', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'doctor.mjs'), 'utf8');
    expect(source).toContain('envResult.dryRunSet');
    expect(source).toContain('defaults to dry-run ON');
    expect(source).toContain('envResult.autosendSet');
    expect(source).toContain('defaults to autosend OFF');
  });

  it('and the code it describes really does fail closed', async () => {
    // If this ever inverts, the message above becomes a lie again — so assert the behaviour,
    // not just the wording.
    const { isDryRun, isAutosendEnabled } = await import('@/lib/emailSafety');
    const savedDryRun = process.env.EMAIL_SEND_DRY_RUN;
    const savedAutosend = process.env.SEQUENCE_AUTOSEND_ENABLED;
    delete process.env.EMAIL_SEND_DRY_RUN;
    delete process.env.SEQUENCE_AUTOSEND_ENABLED;
    try {
      expect(isDryRun()).toBe(true);
      expect(isAutosendEnabled()).toBe(false);
    } finally {
      if (savedDryRun !== undefined) process.env.EMAIL_SEND_DRY_RUN = savedDryRun;
      if (savedAutosend !== undefined) process.env.SEQUENCE_AUTOSEND_ENABLED = savedAutosend;
    }
  });
});
