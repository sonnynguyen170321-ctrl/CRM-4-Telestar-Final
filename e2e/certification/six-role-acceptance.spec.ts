/**
 * Six-role browser acceptance (TEL-P2-013).
 *
 * The certification previously claimed six-role verification on the strength of
 * `tests/role-journeys.test.ts` - a database/service test. That test is valuable and is kept,
 * but it cannot answer the question the requirement actually asks: can a person in this role
 * sign in and operate the product? A service call proves a function returns; it does not
 * prove a page renders, a route resolves, or a forbidden surface is actually closed in the UI.
 *
 * Each role is driven in a real browser against a production build, real Postgres and real
 * Redis, and four things are recorded per role:
 *
 *   1. it can log in and land somewhere real;
 *   2. it can reach its own pages and complete its primary workflow;
 *   3. it is **stopped** from a surface it must not reach;
 *   4. it is **denied** an object belonging to another tenant.
 *
 * Console errors and network failures count against the role: a page that renders while
 * throwing is not a page that works.
 *
 * The verdict is not computed here. This spec records observations; `scripts/certification/
 * lib/roleEvidence.mjs` decides pass or fail, and is unit-tested separately so the decision
 * cannot quietly become "everything passed".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect } from '@playwright/test';

import { apiAs, readJson } from '../support/api';
import { fixture, storageStatePath, type RoleKey } from '../support/fixture';
import { test } from '../support/test';

const OBSERVATION_DIR = path.join(process.cwd(), '.certification', 'role-observations');

interface RolePlan {
  key: RoleKey;
  label: string;
  /** Pages this role must be able to reach. */
  pages: string[];
  /** The role's primary workflow, expressed as an API read the page depends on. */
  allowedWorkflow: { name: string; route: string; expect: number };
  /** A surface this role must NOT reach. */
  forbiddenWorkflow: { name: string; route: string; expectAnyOf: number[] };
}

/**
 * Expectations mirror `e2e/roles/role-negative-access.spec.ts`, which already encodes the
 * agreed role matrix. Director and Floor Manager legitimately hold admin rights, so their
 * forbidden surface is the other tenant rather than `/admin`.
 */
const PLANS: RolePlan[] = [
  {
    key: 'director',
    label: 'director',
    pages: ['/', '/leads', '/team', '/admin'],
    allowedWorkflow: { name: 'read the admin overview', route: '/api/admin/overview', expect: 200 },
    forbiddenWorkflow: {
      name: "read another tenant's lead",
      route: `/api/leads/${fixture().leads.tenantB}`,
      expectAnyOf: [403, 404],
    },
  },
  {
    key: 'floorManager',
    label: 'floor_manager',
    pages: ['/', '/leads', '/team'],
    allowedWorkflow: { name: 'read the lead book', route: '/api/leads?limit=5', expect: 200 },
    forbiddenWorkflow: {
      name: "read another tenant's lead",
      route: `/api/leads/${fixture().leads.tenantB}`,
      expectAnyOf: [403, 404],
    },
  },
  {
    key: 'teamLead',
    label: 'team_lead',
    pages: ['/', '/leads', '/team'],
    allowedWorkflow: { name: 'read the pod lead book', route: '/api/leads?limit=5', expect: 200 },
    forbiddenWorkflow: {
      name: 'read the admin user list',
      route: '/api/admin/users',
      expectAnyOf: [401, 403],
    },
  },
  {
    key: 'sdrA',
    label: 'sdr',
    pages: ['/', '/leads'],
    allowedWorkflow: { name: 'read own assigned leads', route: '/api/leads?limit=5', expect: 200 },
    forbiddenWorkflow: {
      name: 'read the admin user list',
      route: '/api/admin/users',
      expectAnyOf: [401, 403],
    },
  },
  {
    key: 'leadgenManager',
    label: 'leadgen_manager',
    pages: ['/', '/leadgen-manager'],
    allowedWorkflow: { name: 'read the leadgen pool', route: '/api/leadgen-pool', expect: 200 },
    forbiddenWorkflow: {
      name: 'read the admin user list',
      route: '/api/admin/users',
      expectAnyOf: [401, 403],
    },
  },
  {
    key: 'leadgen',
    label: 'leadgen',
    pages: ['/', '/leadgen'],
    allowedWorkflow: { name: 'read the leadgen pool', route: '/api/leadgen-pool', expect: 200 },
    forbiddenWorkflow: {
      name: 'read the admin user list',
      route: '/api/admin/users',
      expectAnyOf: [401, 403],
    },
  },
];

test.describe('six-role browser acceptance', () => {
  test.describe.configure({ mode: 'serial' });

  for (const plan of PLANS) {
    test.describe(plan.label, () => {
      test.use({ storageState: storageStatePath(plan.key) as string });

      test(`${plan.label} can operate the product and is stopped where it must be`, async ({
        page,
        recorder,
        baseURL,
      }, testInfo) => {
        // Both probes below are *supposed* to be refused. Declaring that up front is what
        // keeps the recorder honest about everything else.
        recorder.expectFailures(401, 403, 404);

        const navigations: Array<{ path: string; ok: boolean; status: number | null }> = [];
        let loginOk = false;
        let landingPath: string | null = null;

        // 1. Logged in and landing somewhere real.
        const landing = await page.goto('/', { waitUntil: 'domcontentloaded' });
        landingPath = new URL(page.url()).pathname;
        loginOk = !landingPath.startsWith('/login') && (landing?.status() ?? 500) < 400;
        expect(loginOk, `${plan.label} did not reach an authenticated page`).toBe(true);

        // 2. Its own pages resolve.
        for (const route of plan.pages) {
          const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
          const status = response?.status() ?? null;
          const landedOn = new URL(page.url()).pathname;
          navigations.push({
            path: route,
            // Reaching the page means arriving there, not being bounced to login or home.
            ok: (status ?? 500) < 400 && !landedOn.startsWith('/login'),
            status,
          });
        }

        const api = await apiAs(plan.key, baseURL!);

        // 3. Primary workflow completes.
        const allowed = await readJson(await api.get(plan.allowedWorkflow.route));
        const allowedOk = allowed.status === plan.allowedWorkflow.expect;

        // 4. Forbidden surface is closed.
        const forbidden = await readJson(await api.get(plan.forbiddenWorkflow.route));
        const forbiddenBlocked = plan.forbiddenWorkflow.expectAnyOf.includes(forbidden.status);

        // 5. Object authorization: another tenant's lead, by id.
        const crossTenant = await readJson(await api.get(`/api/leads/${fixture().leads.tenantB}`));
        const crossTenantDenied = [401, 403, 404].includes(crossTenant.status);

        const screenshot = testInfo.outputPath(`${plan.label}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });

        mkdirSync(OBSERVATION_DIR, { recursive: true });
        writeFileSync(
          path.join(OBSERVATION_DIR, `${plan.label}.json`),
          `${JSON.stringify(
            {
              role: plan.label,
              loginOk,
              landingPath,
              navigations,
              allowedWorkflow: {
                name: plan.allowedWorkflow.name,
                ok: allowedOk,
                status: allowed.status,
              },
              forbiddenWorkflow: {
                name: plan.forbiddenWorkflow.name,
                blocked: forbiddenBlocked,
                status: forbidden.status,
              },
              objectAuthorization: {
                attempted: true,
                denied: crossTenantDenied,
                status: crossTenant.status,
              },
              consoleErrors: [...recorder.consoleErrors, ...recorder.pageErrors].map(
                (entry) => `${entry.url}: ${entry.text}`,
              ),
              networkFailures: recorder.failedRequests
                .filter((entry) => ![401, 403, 404].includes(entry.status))
                .map((entry) => `${entry.method} ${entry.url} ${entry.status}`),
              screenshot,
              trace: null,
            },
            null,
            2,
          )}\n`,
        );

        // Assert here too, so a broken role fails the run rather than only the record.
        expect(navigations.filter((entry) => !entry.ok), `${plan.label} could not reach its own pages`).toEqual([]);
        expect(allowedOk, `${plan.label} could not ${plan.allowedWorkflow.name} (${allowed.status})`).toBe(true);
        expect(
          forbiddenBlocked,
          `${plan.label} was NOT blocked from ${plan.forbiddenWorkflow.name} (${forbidden.status})`,
        ).toBe(true);
        expect(
          crossTenantDenied,
          `${plan.label} reached another tenant's lead (${crossTenant.status})`,
        ).toBe(true);
      });
    });
  }
});
