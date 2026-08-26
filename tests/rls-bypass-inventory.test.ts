/**
 * TEL-P1-054. The tenant-bypass inventory was maintained by hand, declared itself "a 100%
 * comprehensive, line-by-line audit of every single location ... where RLS or tenant
 * filtering is bypassed", and concluded that all of them "are accounted for". Sixteen files
 * were missing from it. Two of those carried TEL-P0-013 — a cross-tenant read through
 * exactly the mechanism the document exists to track.
 *
 * The document is now generated from the code, so completeness is not a promise anybody has
 * to keep. What a scan cannot produce is the reason a given bypass is safe, so that lives in
 * `rls-bypass-rationales.json` and a site with no entry renders as UNREVIEWED.
 *
 * These two tests are what make that load-bearing rather than decorative: adding a bypass
 * without writing down why it is safe fails the build, and so does editing the generated
 * document by hand.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const GENERATOR = 'scripts/certification/render-rls-bypass-inventory.mjs';

function runGenerator(args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [GENERATOR, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('the tenant bypass inventory is generated, complete and reviewed', () => {
  it('every bypass on the request path carries a written reason', () => {
    const { status, output } = runGenerator(['--check']);

    expect(
      output,
      'a bypass with no entry in rls-bypass-rationales.json renders UNREVIEWED — write down why it is safe',
    ).toContain('unreviewed : 0');
    expect(status, output).toBe(0);
  });

  it('the checked-in document matches what the generator produces', () => {
    const { output } = runGenerator(['--check']);

    expect(
      output,
      'RLS_BYPASS_INVENTORY.md is generated — run `node scripts/certification/render-rls-bypass-inventory.mjs` rather than editing it',
    ).toContain('drift      : none');
  });
});
