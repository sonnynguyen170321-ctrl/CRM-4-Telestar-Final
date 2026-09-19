/**
 * Every management act writes an `admin.*` audit row — the kind the Audit Log opens on.
 *
 * The log has two feeds. The Prisma extension records every create/update on every model,
 * which is complete and unreadable: notifications, job runs and import rows drown anything a
 * person would look for. `logAdminAudit` records the acts a manager took, under `admin.*`,
 * and the Audit Log page opens on that view. Only user and client routes wrote to it.
 *
 * In the 2026-09-19 role-play a director created a campaign and an ICP, transferred a book,
 * opened the Audit Log and read "No audit entries in this window". Everything had been
 * recorded — in the feed nobody opens.
 *
 * This pins the set. Adding a management route means adding it here, which is the moment to
 * decide what it is called.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADMIN_AUDIT_ACTIONS } from '@/lib/audit';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Route → the admin action it must record. */
const MANAGEMENT_ROUTES: Array<[string, string]> = [
  ['app/api/campaigns/route.ts', 'admin.campaign.create'],
  ['app/api/campaigns/[id]/route.ts', 'admin.campaign.update'],
  ['app/api/icp/profiles/route.ts', 'admin.icp.create'],
  ['app/api/icp/versions/[id]/publish/route.ts', 'admin.icp.publish'],
  ['app/api/email-health/accounts/[id]/pause/route.ts', 'admin.mailbox.pause'],
  ['app/api/email-health/accounts/[id]/resume/route.ts', 'admin.mailbox.resume'],
  ['app/api/email-health/accounts/[id]/cap/route.ts', 'admin.mailbox.cap'],
  ['app/api/sequences/[id]/route.ts', 'admin.sequence.archive'],
  // The ones that were already there, so a refactor cannot quietly drop them.
  ['app/api/users/route.ts', 'admin.user.create'],
  ['app/api/clients/route.ts', 'admin.client.create'],
  ['lib/admin/transferWork.ts', 'admin.work.transfer'],
];

describe('management routes record an admin audit action', () => {
  for (const [route, action] of MANAGEMENT_ROUTES) {
    it(`${route} records ${action}`, () => {
      const src = read(route);
      expect(src, `${route} does not import logAdminAudit`).toMatch(/logAdminAudit/);
      // Either quote style — the ICP routes are double-quoted, the rest single.
      expect(src, `${route} does not record ${action}`).toMatch(new RegExp(`['"]${action.replace(/\./g, '\\.')}['"]`));
      // The action has to be one the type admits, or the call would not compile — but the
      // union is also what the log's filter dropdown is built from, so drift shows here first.
      expect(ADMIN_AUDIT_ACTIONS as readonly string[]).toContain(action);
    });
  }
});

describe('the Audit Log reads the admin feed by default', () => {
  it('opens on "admin" scope, which filters on the admin.* prefix', () => {
    const page = read('app/admin/audit/page.tsx');
    const api = read('app/api/admin/audit-log/route.ts');
    expect(page).toMatch(/useState<'admin' \| 'all'>\('admin'\)/);
    expect(api).toMatch(/action:\s*\{\s*startsWith:\s*'admin\.'\s*\}/);
  });
});
