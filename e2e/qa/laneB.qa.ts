/**
 * Lane B — manager visibility, pod-scoping correctness, dashboard usefulness.
 * READ-ONLY. Creates nothing, mutates nothing.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { attachRecorders, gotoTimed, login, logout, shot, laneDir } from './_helpers';
import { PERSONAS } from './personas';

const LANE = 'B';

type Row = Record<string, unknown>;

function dump(name: string, data: unknown): void {
  fs.writeFileSync(
    path.join(laneDir(LANE, 'data'), `${name}.json`),
    JSON.stringify(data, null, 2)
  );
}

async function getJson(page: import('@playwright/test').Page, url: string) {
  const res = await page.request.get(url);
  const status = res.status();
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  return { status, body };
}

const MANAGERS = [
  { key: 'director', email: PERSONAS.director },
  { key: 'floorManager', email: PERSONAS.floorManager },
  { key: 'floorManagerAlt', email: PERSONAS.floorManagerAlt },
  { key: 'teamLead', email: PERSONAS.teamLead },
] as const;

test.describe('Lane B — scoping', () => {
  for (const m of MANAGERS) {
    test(`capture scoping surface for ${m.key}`, async ({ page }) => {
      test.setTimeout(180000);
      const rec = attachRecorders(page, LANE);
      await login(page, m.email);

      const session = await getJson(page, '/api/auth/session');
      const users = await getJson(page, '/api/users');
      const leads = await getJson(page, '/api/leads?limit=500');
      const leaderboard = await getJson(page, '/api/team/leaderboard?dateRange=month');
      const alerts = await getJson(page, '/api/team/alerts');
      const activities = await getJson(page, '/api/activities');
      const campaigns = await getJson(page, '/api/campaigns');
      const meetings = await getJson(page, '/api/meetings');
      const opportunities = await getJson(page, '/api/opportunities');
      const tasks = await getJson(page, '/api/tasks');

      const userRows = Array.isArray(users.body) ? (users.body as Row[]) : [];
      const leadRows = Array.isArray(leads.body) ? (leads.body as Row[]) : [];

      const payload = {
        persona: m.key,
        email: m.email,
        session: session.body,
        users: {
          status: users.status,
          count: userRows.length,
          emails: userRows.map((u) => u.email).sort(),
        },
        leads: {
          status: leads.status,
          count: leadRows.length,
          byAssignee: countBy(
            leadRows.map((l) => {
              const a = l.assignedTo as { firstName?: string; lastName?: string } | null;
              return a ? `${a.firstName} ${a.lastName}` : '(unassigned)';
            })
          ),
          sample: leadRows.slice(0, 400).map((l) => ({
            id: l.id,
            name: `${l.firstName} ${l.lastName}`,
            company: l.company,
            assignee: (l.assignedTo as { firstName?: string; lastName?: string } | null)
              ? `${(l.assignedTo as Row).firstName} ${(l.assignedTo as Row).lastName}`
              : null,
            campaign: (l.campaign as { name?: string } | null)?.name ?? null,
          })),
        },
        leaderboard: {
          status: leaderboard.status,
          count: Array.isArray(leaderboard.body) ? leaderboard.body.length : null,
          body: leaderboard.body,
        },
        alerts: {
          status: alerts.status,
          userCount: Array.isArray((alerts.body as Row)?.users)
            ? ((alerts.body as Row).users as Row[]).length
            : null,
          body: alerts.body,
        },
        activities: {
          status: activities.status,
          count: Array.isArray(activities.body) ? activities.body.length : null,
        },
        campaigns: {
          status: campaigns.status,
          count: Array.isArray(campaigns.body) ? campaigns.body.length : null,
          names: Array.isArray(campaigns.body)
            ? (campaigns.body as Row[]).map((c) => c.name)
            : null,
        },
        meetings: { status: meetings.status, count: arrLen(meetings.body) },
        opportunities: { status: opportunities.status, count: arrLen(opportunities.body) },
        tasks: { status: tasks.status, count: arrLen(tasks.body) },
      };

      dump(`scope-${m.key}`, payload);
      await logout(page);
      rec.flush(`scope-${m.key}`);
      expect(session.status).toBe(200);
    });
  }
});

/* ------------------------------------------------------------------ *
 * Row-level cross-pod probe. Director enumerates the org + every
 * meeting/opportunity/task/lead with its owner. Then brandon (team lead,
 * pod = lan.pham + david.miller) and alayna (other floor) try to read
 * rows that belong to jackie's pod / sonny's floor.
 * ------------------------------------------------------------------ */

test.describe('Lane B — cross-pod probe', () => {
  test('director enumerates org + owned rows (baseline)', async ({ page }) => {
    test.setTimeout(180000);
    const rec = attachRecorders(page, LANE);
    await login(page, PERSONAS.director);

    const users = (await getJson(page, '/api/users')).body as Row[];
    const leads = (await getJson(page, '/api/leads?limit=500')).body as Row[];
    const meetingsRes = await getJson(page, '/api/meetings?limit=500');
    const oppsRes = await getJson(page, '/api/opportunities?limit=500');
    const tasksRes = await getJson(page, '/api/tasks');
    const acts = (await getJson(page, '/api/activities?limit=200')).body as Row[];

    const byId = new Map(users.map((u) => [u.id as string, u.email as string]));
    const meetings = (meetingsRes.body as Row[]) ?? [];
    const opps = ((oppsRes.body as Row)?.opportunities as Row[]) ?? [];
    const tasks = Array.isArray(tasksRes.body) ? (tasksRes.body as Row[]) : [];

    const baseline = {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        managerId: u.managerId,
        manager: byId.get(u.managerId as string) ?? null,
      })),
      leads: leads.map((l) => ({
        id: l.id,
        name: `${l.firstName} ${l.lastName}`,
        assigneeId: (l.assignedTo as Row)?.id ?? null,
        assignee: (l.assignedTo as Row)
          ? `${(l.assignedTo as Row).firstName} ${(l.assignedTo as Row).lastName}`
          : null,
        campaign: (l.campaign as Row)?.name ?? null,
        campaignId: (l.campaign as Row)?.id ?? null,
      })),
      meetings: meetings.map((m) => ({
        id: m.id,
        title: m.title,
        sdrId: (m.sdr as Row)?.id ?? null,
        sdr: (m.sdr as Row) ? `${(m.sdr as Row).firstName} ${(m.sdr as Row).lastName}` : null,
        sdrEmail: byId.get((m.sdr as Row)?.id as string) ?? null,
        leadId: (m.lead as Row)?.id ?? null,
        client: (m.client as Row)?.name ?? null,
        campaign: (m.campaign as Row)?.name ?? null,
      })),
      opportunities: opps.map((o) => ({
        id: o.id,
        title: o.title,
        ownerId: (o.owner as Row)?.id ?? null,
        ownerEmail: byId.get((o.owner as Row)?.id as string) ?? null,
        createdByEmail: byId.get((o.createdBy as Row)?.id as string) ?? null,
        campaign: (o.campaign as Row)?.name ?? null,
        client: (o.client as Row)?.name ?? null,
        value: o.value,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        type: t.type,
        userId: t.userId,
        ownerEmail: byId.get(t.userId as string) ?? null,
        leadId: t.leadId,
      })),
      activityOwners: countBy(
        (acts ?? []).map((a) => byId.get((a.user as Row)?.id as string) ?? 'unknown')
      ),
    };

    dump('baseline-director', baseline);
    await logout(page);
    rec.flush('baseline-director');
    expect(baseline.users.length).toBeGreaterThan(10);
  });

  for (const probe of [
    { key: 'teamLead', email: PERSONAS.teamLead, ownPod: ['lan.pham@telestar.vn', 'david.miller@telestar.vn', 'brandon@telestar.vn'] },
    { key: 'floorManagerAlt', email: PERSONAS.floorManagerAlt, ownPod: ['alayna@telestar.vn', 'hayden@telestar.vn', 'kim@telestar.vn', 'selina@telestar.vn'] },
  ] as const) {
    test(`${probe.key} cross-pod direct-read probe`, async ({ page }) => {
      test.setTimeout(240000);
      const rec = attachRecorders(page, LANE);
      const baseline = JSON.parse(
        fs.readFileSync(path.join(laneDir(LANE, 'data'), 'baseline-director.json'), 'utf8')
      );
      await login(page, probe.email);

      const own = new Set<string>(probe.ownPod as readonly string[]);

      // Leads owned by someone OUTSIDE this viewer's pod
      const foreignLeads = baseline.leads.filter((l: Row) => {
        const a = baseline.users.find((u: Row) => u.id === l.assigneeId);
        return a && !own.has(a.email as string);
      });

      const leadProbes: Row[] = [];
      for (const l of foreignLeads.slice(0, 8)) {
        const r = await getJson(page, `/api/leads/${l.id}`);
        leadProbes.push({
          leadId: l.id,
          leadName: l.name,
          owner: l.assignee,
          campaign: l.campaign,
          status: r.status,
          leaked: r.status === 200,
          returnedEmail: r.status === 200 ? (r.body as Row).email : null,
        });
      }

      const foreignMeetings = baseline.meetings.filter(
        (m: Row) => m.sdrEmail && !own.has(m.sdrEmail as string)
      );
      const meetingProbes: Row[] = [];
      for (const m of foreignMeetings.slice(0, 6)) {
        const r = await getJson(page, `/api/meetings/${m.id}`);
        meetingProbes.push({ id: m.id, title: m.title, sdr: m.sdr, status: r.status, leaked: r.status === 200 });
      }

      const foreignOpps = baseline.opportunities.filter(
        (o: Row) => o.ownerEmail && !own.has(o.ownerEmail as string)
      );
      const oppProbes: Row[] = [];
      for (const o of foreignOpps.slice(0, 6)) {
        const r = await getJson(page, `/api/opportunities/${o.id}`);
        oppProbes.push({ id: o.id, title: o.title, owner: o.ownerEmail, status: r.status, leaked: r.status === 200 });
      }

      // Parameter-forcing: can this viewer pivot the team endpoints onto an
      // out-of-pod user id?
      const foreignUser = baseline.users.find(
        (u: Row) => !own.has(u.email as string) && u.role === 'sdr'
      );
      const forced = foreignUser
        ? {
            targetEmail: foreignUser.email,
            leaderboard: (await getJson(page, `/api/team/leaderboard?sdrId=${foreignUser.id}`)).status,
            alerts: (await getJson(page, `/api/team/alerts?sdrId=${foreignUser.id}`)).status,
            activities: (await getJson(page, `/api/activities?userId=${foreignUser.id}`)).status,
            tasks: (await getJson(page, `/api/tasks?userId=${foreignUser.id}`)).status,
            leadsAssignedTo: await (async () => {
              const r = await getJson(page, `/api/leads?assignedTo=${foreignUser.id}`);
              return { status: r.status, count: arrLen(r.body) };
            })(),
            meetingsBySdr: await (async () => {
              const r = await getJson(page, `/api/meetings?sdrId=${foreignUser.id}`);
              return { status: r.status, count: arrLen(r.body) };
            })(),
          }
        : null;

      // What this viewer sees on the collection endpoints, with identities
      const myMeetings = (await getJson(page, '/api/meetings?limit=500')).body as Row[];
      const myOppsRes = await getJson(page, '/api/opportunities?limit=500');
      const myOpps = ((myOppsRes.body as Row)?.opportunities as Row[]) ?? [];
      const myTasks = await getJson(page, '/api/tasks');
      const myActs = (await getJson(page, '/api/activities?limit=200')).body as Row[];

      const result = {
        persona: probe.key,
        ownPod: probe.ownPod,
        leadProbes,
        meetingProbes,
        oppProbes,
        forcedParams: forced,
        collections: {
          meetings: (myMeetings ?? []).map((m) => ({
            id: m.id,
            title: m.title,
            sdr: (m.sdr as Row) ? `${(m.sdr as Row).firstName} ${(m.sdr as Row).lastName}` : null,
            client: (m.client as Row)?.name ?? null,
          })),
          opportunities: myOpps.map((o) => ({
            id: o.id,
            title: o.title,
            owner: (o.owner as Row) ? `${(o.owner as Row).firstName} ${(o.owner as Row).lastName}` : null,
            client: (o.client as Row)?.name ?? null,
            value: o.value,
          })),
          taskOwners: Array.isArray(myTasks.body)
            ? countBy((myTasks.body as Row[]).map((t) => String(t.userId)))
            : null,
          activityOwners: countBy(
            (myActs ?? []).map((a) =>
              (a.user as Row) ? `${(a.user as Row).firstName} ${(a.user as Row).lastName}` : 'unknown'
            )
          ),
        },
      };

      dump(`probe-${probe.key}`, result);
      await logout(page);
      rec.flush(`probe-${probe.key}`);
      expect(leadProbes.length).toBeGreaterThan(0);
    });
  }
});

/* ------------------------------------------------------------------ *
 * Team View content — 5 tabs, per manager role.
 * ------------------------------------------------------------------ */

const TEAM_TABS = ['Campaigns', 'Team Performance', 'Rep Progress & Conversion', 'Sequences', 'Meetings'];

test.describe('Lane B — team view content', () => {
  for (const m of MANAGERS) {
    test(`/team tabs render for ${m.key}`, async ({ page }) => {
      test.setTimeout(240000);
      const rec = attachRecorders(page, LANE);
      await login(page, m.email);
      const nav = await gotoTimed(page, '/team', rec);

      const tabReport: Row[] = [];
      for (const tab of TEAM_TABS) {
        const btn = page.locator('button', { hasText: new RegExp(`^${tab.replace(/&/g, '&')}$`) }).first();
        const exists = await btn.isVisible({ timeout: 4000 }).catch(() => false);
        if (!exists) {
          tabReport.push({ tab, present: false });
          continue;
        }
        await btn.click();
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(700);
        const text = (await page.locator('main').innerText().catch(() => '')) || (await page.locator('body').innerText());
        await shot(page, LANE, `team-${m.key}-${tab}`);
        tabReport.push({
          tab,
          present: true,
          chars: text.length,
          hasZeroOnly: /^[\s\S]*$/.test(text) && !/[1-9]/.test(text.replace(/\d{4}/g, '')),
          text: text.slice(0, 3500),
        });
      }

      dump(`team-tabs-${m.key}`, { persona: m.key, finalUrl: nav.finalUrl, tabs: tabReport });
      await logout(page);
      rec.flush(`team-tabs-${m.key}`);
      expect(nav.finalUrl).toContain('/team');
    });
  }
});

/* ------------------------------------------------------------------ *
 * Director cockpit + Floor Manager operations pages.
 * ------------------------------------------------------------------ */

test.describe('Lane B — manager pages', () => {
  test('director cockpit content', async ({ page }) => {
    test.setTimeout(180000);
    const rec = attachRecorders(page, LANE);
    await login(page, PERSONAS.director);
    const nav = await gotoTimed(page, '/director', rec);
    await page.waitForTimeout(1500);
    const text = await page.locator('body').innerText();
    await shot(page, LANE, 'director-cockpit');
    const h1 = await page.locator('h1').allInnerTexts();
    dump('director-cockpit', { finalUrl: nav.finalUrl, h1, text: text.slice(0, 6000) });
    await logout(page);
    rec.flush('director-cockpit');
    expect(nav.finalUrl).toContain('/director');
  });

  const FM_PAGES = ['/client-reports', '/email-health', '/opportunities', '/meetings'] as const;

  test('floor manager operations pages', async ({ page }) => {
    test.setTimeout(300000);
    const rec = attachRecorders(page, LANE);
    await login(page, PERSONAS.floorManager);
    const pages: Row[] = [];
    for (const p of FM_PAGES) {
      const nav = await gotoTimed(page, p, rec);
      await page.waitForTimeout(1800);
      const text = await page.locator('body').innerText();
      await shot(page, LANE, `fm-${p.replace(/\//g, '')}`);
      pages.push({ path: p, finalUrl: nav.finalUrl, chars: text.length, text: text.slice(0, 4000) });
    }
    dump('fm-pages', { persona: 'floorManager', pages });
    await logout(page);
    rec.flush('fm-pages');
    expect(pages.length).toBe(FM_PAGES.length);
  });

  test('team lead coaching surface', async ({ page }) => {
    test.setTimeout(300000);
    const rec = attachRecorders(page, LANE);
    await login(page, PERSONAS.teamLead);

    const visited: Row[] = [];
    for (const p of ['/', '/team', '/leads', '/opportunities', '/meetings', '/client-reports', '/email-health', '/director']) {
      const nav = await gotoTimed(page, p, rec);
      await page.waitForTimeout(1400);
      const text = await page.locator('body').innerText();
      await shot(page, LANE, `tl-${p === '/' ? 'dashboard' : p.replace(/\//g, '')}`);
      visited.push({ path: p, finalUrl: nav.finalUrl, redirected: !nav.finalUrl.endsWith(p) && p !== '/', chars: text.length, text: text.slice(0, 3000) });
    }
    dump('tl-coaching', { persona: 'teamLead', visited });
    await logout(page);
    rec.flush('tl-coaching');
    expect(visited.length).toBe(8);
  });
});

/* Sequences tab was blank for director + teamLead on the first pass. Re-probe
 * with a generous wait to separate "slow" from "stuck/empty". */
test.describe('Lane B — sequences tab retest', () => {
  for (const m of [MANAGERS[0], MANAGERS[3]] as const) {
    test(`sequences tab settles for ${m.key}`, async ({ page }) => {
      test.setTimeout(240000);
      const rec = attachRecorders(page, LANE);
      await login(page, m.email);

      const t0 = Date.now();
      const api = await getJson(page, '/api/sequences/team-analytics');
      const apiMs = Date.now() - t0;

      await gotoTimed(page, '/team', rec);
      await page.locator('button', { hasText: /^Sequences$/ }).first().click();
      await page.waitForTimeout(20000);
      const text = await page.locator('body').innerText();
      await shot(page, LANE, `seqtab-retest-${m.key}`);
      const spinner = await page.locator('.animate-spin').count();

      dump(`seqtab-retest-${m.key}`, {
        persona: m.key,
        apiStatus: api.status,
        apiMs,
        apiBody: api.body,
        spinnersOnPage: spinner,
        text,
      });
      await logout(page);
      rec.flush(`seqtab-retest-${m.key}`);
      expect(api.status).toBeGreaterThan(0);
    });
  }
});

function arrLen(b: unknown): number | null {
  if (Array.isArray(b)) return b.length;
  if (b && typeof b === 'object') {
    for (const k of ['data', 'items', 'meetings', 'opportunities', 'results']) {
      const v = (b as Row)[k];
      if (Array.isArray(v)) return v.length;
    }
  }
  return null;
}

function countBy(vals: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vals) out[v] = (out[v] ?? 0) + 1;
  return out;
}
