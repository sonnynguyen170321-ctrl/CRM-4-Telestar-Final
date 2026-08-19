/**
 * The six-role browser-evidence emitter (TEL-P2-013).
 *
 * The Playwright spec observes each role in a real browser and writes raw observations. This
 * module turns those observations into the evidence record the validator consumes, and it is
 * the piece that decides whether a role **passed**.
 *
 * That decision is worth testing on its own, because the failure mode being corrected is
 * precisely a green verdict nobody computed. A role that logged in, reached its pages, and
 * was *not* stopped from doing something it must not do has not passed - it has found an
 * authorization hole, and an emitter that reports PASS there would recreate the defect this
 * whole program exists to remove.
 */
import { describe, expect, it } from 'vitest';

import { buildRoleBrowserEvidence } from '@/scripts/certification/lib/roleEvidence.mjs';

const CANDIDATE = 'a'.repeat(40);

type Observation = Parameters<typeof buildRoleBrowserEvidence>[0][number];

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    role: 'director',
    loginOk: true,
    landingPath: '/',
    navigations: [
      { path: '/leads', ok: true, status: 200 },
      { path: '/team', ok: true, status: 200 },
    ],
    allowedWorkflow: { name: 'open a lead', ok: true },
    forbiddenWorkflow: { name: 'reach another tenant lead', blocked: true, status: 403 },
    objectAuthorization: { attempted: true, denied: true, status: 403 },
    consoleErrors: [],
    networkFailures: [],
    screenshot: null,
    trace: null,
    ...overrides,
  };
}

function build(observations: Observation[]) {
  return buildRoleBrowserEvidence(observations, {
    candidateSha: CANDIDATE,
    environment: 'test',
    startedAt: '2026-08-20T09:00:00+07:00',
    finishedAt: '2026-08-20T09:10:00+07:00',
  });
}

describe('a role passes only when every observation supports it', () => {
  it('reports PASS for a role that did everything it should and nothing it should not', () => {
    const record = build([observation()]);

    expect(record.metrics.roles.director.status).toBe('PASS');
  });

  it('fails a role that could not log in', () => {
    const record = build([observation({ loginOk: false })]);

    expect(record.metrics.roles.director.status).toBe('FAIL');
    expect(record.metrics.roles.director.reasons).toContain('login failed');
  });

  it('fails a role that could not reach one of its own pages', () => {
    const record = build([
      observation({
        navigations: [
          { path: '/leads', ok: true, status: 200 },
          { path: '/team', ok: false, status: 500 },
        ],
      }),
    ]);

    expect(record.metrics.roles.director.status).toBe('FAIL');
    expect(record.metrics.roles.director.reasons.join(' ')).toContain('/team');
  });

  it('fails a role whose primary workflow did not complete', () => {
    const record = build([observation({ allowedWorkflow: { name: 'open a lead', ok: false } })]);

    expect(record.metrics.roles.director.status).toBe('FAIL');
    expect(record.metrics.roles.director.reasons.join(' ')).toContain('open a lead');
  });

  it('fails a role that was NOT stopped from doing something forbidden', () => {
    // The most important case: reaching a forbidden surface is an authorization hole, and
    // reporting it as a pass is exactly the false green this program removes.
    const record = build([
      observation({
        forbiddenWorkflow: { name: 'reach another tenant lead', blocked: false, status: 200 },
      }),
    ]);

    expect(record.metrics.roles.director.status).toBe('FAIL');
    expect(record.metrics.roles.director.reasons.join(' ')).toContain('not blocked');
  });

  it('fails a role whose object-authorization attempt was allowed', () => {
    const record = build([
      observation({ objectAuthorization: { attempted: true, denied: false, status: 200 } }),
    ]);

    expect(record.metrics.roles.director.status).toBe('FAIL');
  });

  it('fails a role that never attempted the object-authorization probe', () => {
    const record = build([
      observation({ objectAuthorization: { attempted: false, denied: false, status: null } }),
    ]);

    expect(record.metrics.roles.director.status).toBe('FAIL');
    expect(record.metrics.roles.director.reasons.join(' ')).toContain('not attempted');
  });

  it('fails a role that produced console errors', () => {
    const record = build([observation({ consoleErrors: ['TypeError: undefined is not a function'] })]);

    expect(record.metrics.roles.director.status).toBe('FAIL');
    expect(record.metrics.roles.director.consoleErrors).toBe(1);
  });

  it('fails a role that produced network failures', () => {
    const record = build([observation({ networkFailures: ['GET /api/leads 500'] })]);

    expect(record.metrics.roles.director.status).toBe('FAIL');
    expect(record.metrics.roles.director.networkFailures).toBe(1);
  });
});

describe('the record as a whole', () => {
  const SIX = [
    'director',
    'floor_manager',
    'team_lead',
    'sdr',
    'leadgen_manager',
    'leadgen',
  ];

  it('is PASS only when all six roles are present and passing', () => {
    const record = build(SIX.map((role) => observation({ role })));

    expect(record.status).toBe('PASS');
    expect(record.exitCode).toBe(0);
    expect(Object.keys(record.metrics.roles)).toHaveLength(6);
  });

  it('is FAIL when a required role was never observed', () => {
    const record = build(SIX.slice(0, 5).map((role) => observation({ role })));

    expect(record.status).toBe('FAIL');
    expect(record.metrics.missingRoles).toContain('leadgen');
  });

  it('is FAIL when any single role failed', () => {
    const observations = SIX.map((role) =>
      role === 'sdr' ? observation({ role, loginOk: false }) : observation({ role }),
    );

    expect(build(observations).status).toBe('FAIL');
  });

  it('carries the candidate SHA and a non-zero exit code on failure', () => {
    const record = build([observation({ loginOk: false })]);

    expect(record.candidateSha).toBe(CANDIDATE);
    expect(record.exitCode).not.toBe(0);
  });

  it('is shaped as an evidence record the validator can consume', () => {
    const record = build(SIX.map((role) => observation({ role })));

    expect(record).toMatchObject({
      evidenceId: 'EV-ROLE-BROWSER',
      kind: 'role-browser',
      environment: 'test',
      startedAt: '2026-08-20T09:00:00+07:00',
      finishedAt: '2026-08-20T09:10:00+07:00',
    });
    expect(Array.isArray(record.artifacts)).toBe(true);
  });
});
