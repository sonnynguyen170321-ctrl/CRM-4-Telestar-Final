/**
 * §7 — the role matrix, asserted at the API as well as the UI.
 *
 * The rule this file exists to enforce: **UI and API must agree.** A role whose sidebar entry
 * is hidden but whose endpoint answers 200 is not restricted, it is merely undiscoverable, and
 * the audit brief is explicit that hidden buttons are not evidence. So every negative case is
 * checked twice — the page must not render, *and* the endpoint must refuse.
 *
 * Expectations are derived from source, not from the current behaviour:
 *   - `proxy.ts:8` ADMIN_ROLES = director, floor_manager
 *   - `app/api/leadgen-pool/guard.ts` canAccessPool / requirePoolManager
 *   - `lib/auth.ts:188` canImportExport — Team Lead deliberately excluded
 *   - `lib/opportunities/access.ts:32` canApproveClientHandoff
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture, storageStatePath, type RoleKey } from '../support/fixture';

type Denial = { role: RoleKey; label: string };

const NON_ADMIN: Denial[] = [
  { role: 'teamLead', label: 'team_lead' },
  { role: 'sdrA', label: 'sdr' },
  { role: 'leadgenManager', label: 'leadgen_manager' },
  { role: 'leadgen', label: 'leadgen' },
];

const ADMIN_PAGES = ['/admin', '/admin/users', '/admin/teams', '/admin/campaigns', '/admin/clients', '/admin/audit', '/admin/jobs'];

test.describe('admin surface is closed to non-admin roles', () => {
  for (const { role, label } of NON_ADMIN) {
    test.describe(label, () => {
      test.use({ storageState: storageStatePath(role) as string });

      for (const route of ADMIN_PAGES) {
        test(`${label} is redirected away from ${route}`, async ({ page }) => {
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          // proxy.ts sends them to '/' before any admin HTML is produced.
          expect(new URL(page.url()).pathname, `${label} reached ${route}`).not.toContain('/admin');
        });
      }

      test(`${label} is refused by the admin API, not merely hidden from it`, async ({ baseURL, recorder }) => {
        recorder.expectFailures(401, 403);
        const api = await apiAs(role, baseURL!);
        for (const route of ['/api/admin/users', '/api/admin/overview', '/api/admin/audit-log', '/api/admin/jobs']) {
          const { status } = await readJson(await api.get(route));
          expect([401, 403], `${label} got ${status} from ${route}`).toContain(status);
        }
        await api.dispose();
      });
    });
  }
});

test.describe('leadgen pool access', () => {
  // canAccessPool: director, floor_manager, leadgen_manager, leadgen. Everyone else 403.
  for (const { role, label } of [
    { role: 'teamLead' as RoleKey, label: 'team_lead' },
    { role: 'sdrA' as RoleKey, label: 'sdr' },
  ]) {
    test(`${label} cannot read the lead pool`, async ({ baseURL, recorder }) => {
      recorder.expectFailures(403);
      const api = await apiAs(role, baseURL!);
      const { status } = await readJson(await api.get('/api/leadgen-pool'));
      expect(status, `${label} should be refused the pool`).toBe(403);
      await api.dispose();
    });
  }

  test('a leadgen member cannot perform manager-only pool actions', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403);
    const api = await apiAs('leadgen', baseURL!);

    // Reading the pool is permitted for a member…
    const read = await readJson(await api.get('/api/leadgen-pool'));
    expect(read.status, 'a leadgen member should be able to read the pool').toBe(200);

    // …but requirePoolManager gates the rest.
    for (const route of ['/api/leadgen-pool/requirements', '/api/leadgen-pool/assignable-reps']) {
      const { status } = await readJson(await api.get(route));
      expect(status, `leadgen member got ${status} from ${route}`).toBe(403);
    }
    await api.dispose();
  });
});

test.describe('import and export', () => {
  // canImportExport excludes Team Lead on purpose, even though they outrank an SDR who can.
  test('a team lead cannot import leads', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403);
    const api = await apiAs('teamLead', baseURL!);
    const res = await api.post('/api/leads/import', {
      multipart: {
        file: {
          name: 'PW_AUDIT_denied.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from('firstName,lastName,email,company\nPW,Denied,denied@audit.test,PW_AUDIT_CO\n'),
        },
      },
    });
    const { status } = await readJson(res);
    expect(status, 'Team Lead import must be refused').toBe(403);
    await api.dispose();
  });

  test('an SDR can reach the import endpoint', async ({ baseURL, recorder }) => {
    // The mirror case. Without it, a blanket 403 for everyone would pass the test above and
    // still be wrong.
    recorder.expectFailures(400, 403, 422);
    const api = await apiAs('sdrA', baseURL!);
    const res = await api.post('/api/leads/import', { multipart: {} });
    const { status } = await readJson(res);
    expect(status, 'an SDR must not be refused on role grounds').not.toBe(403);
    await api.dispose();
  });
});

test.describe('manager-only reads', () => {
  test('an SDR cannot read team leaderboard data', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403);
    const api = await apiAs('sdrA', baseURL!);
    for (const route of ['/api/team/leaderboard', '/api/team/alerts', '/api/team/sdr-progress']) {
      const { status } = await readJson(await api.get(route));
      expect(status, `SDR got ${status} from ${route}`).toBe(403);
    }
    await api.dispose();
  });

  test('a floor manager can read the same team data', async ({ baseURL }) => {
    const api = await apiAs('floorManager', baseURL!);
    // `/api/team/sdr-progress` requires `sdrId` and answers 400 without it
    // (app/api/team/sdr-progress/route.ts:20-22) — that is input validation, not authorization,
    // so the control has to supply it or it measures the wrong thing.
    const routes = [
      '/api/team/leaderboard',
      '/api/team/alerts',
      `/api/team/sdr-progress?sdrId=${fixture().users.sdrA.id}`,
    ];
    for (const route of routes) {
      const { status } = await readJson(await api.get(route));
      expect(status, `floor manager got ${status} from ${route}`).toBe(200);
    }
    await api.dispose();
  });
});
