/**
 * Completing a LinkedIn or WhatsApp task must not claim work the server refused.
 *
 * A LinkedIn step is the one part of a sequence a person does by hand, so this modal is the whole
 * of that flow: log the touch, optionally move the lead's stage, done. Two things went wrong in it,
 * and both told the operator the opposite of what happened.
 *
 * `submitComplete` checks `res.ok` and toasts "Failed to update task" — but it only `return`s from
 * itself. `handleLoggingSubmit` awaited it, learned nothing, and carried on to move the stage and
 * announce it. And the stage `PUT` never looked at its own response, so
 * "Lead moved to meeting booked" appeared whether the lead moved or not — a 403 on a colleague's
 * lead reads exactly like success.
 *
 * Asserted against the source because this page is a large client component and the repo has no
 * DOM test environment (see tests/research-phase-3-workspace.test.ts for the same approach). What
 * is pinned here is the control flow: the caller must be able to see a failure, and must not
 * announce a move it did not verify.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8');

/** The body of `handleLoggingSubmit`, which is where both failures lived. */
function loggingSubmitBody(): string {
  const start = source.indexOf('const handleLoggingSubmit');
  expect(start, 'handleLoggingSubmit has been renamed — update this test with it').toBeGreaterThan(-1);
  const next = source.indexOf('\n  const ', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('submitComplete reports its outcome to the caller', () => {
  it('returns a result rather than swallowing the failure', () => {
    const start = source.indexOf('const submitComplete');
    const body = source.slice(start, source.indexOf('\n  const ', start + 10));
    expect(body).toMatch(/return false/);
    expect(body).toMatch(/return true/);
  });
});

describe('the LinkedIn / WhatsApp logging flow', () => {
  const body = loggingSubmitBody();

  it('stops when the task itself could not be completed', () => {
    // Without this the modal goes on to move the lead and announce it, on top of a task the
    // server just refused.
    expect(body).toMatch(/if\s*\(!\s*(completed|ok)\b/);
  });

  it('checks the stage update before saying the lead moved', () => {
    const stageBlock = body.slice(body.indexOf('responseStage &&'));
    expect(stageBlock, 'the stage PUT response must be read').toMatch(/\.ok\b/);
  });

  it('does not announce a move it has not verified', () => {
    const stageBlock = body.slice(body.indexOf('responseStage &&'));
    const successToast = stageBlock.indexOf('Lead moved to');
    const okCheck = stageBlock.indexOf('.ok');
    expect(okCheck, 'the response is checked before the success toast is shown').toBeLessThan(successToast);
  });

  it('tells the operator when the move failed, rather than staying silent', () => {
    const stageBlock = body.slice(body.indexOf('responseStage &&'));
    expect(stageBlock).toMatch(/'error'|"error"/);
  });
});
