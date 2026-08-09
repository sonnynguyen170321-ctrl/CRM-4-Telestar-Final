/**
 * §31, §32, §33 — the meeting → outcome → opportunity → handoff chain.
 *
 * This is the revenue path, and it is the one `docs/post-migration/BUGS.md` BUG-003 records as
 * having been "covered" by a spec that printed `🎉 ALL 31 STEPS PASSED PERFECTLY!` while the
 * chain never executed. So the assertions here are deliberately specific: the opportunity has
 * to exist, be linked to the right lead, and be **exactly one** of it.
 *
 * Everything is synchronous — `createOpportunityFromQualifiedMeeting` runs inside the outcome
 * request — so none of this is blocked on Redis.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix } from '../support/ids';
import type { APIRequestContext } from '@playwright/test';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

async function createLead(api: APIRequestContext) {
  const s = stamp();
  const { status, body } = await readJson(
    await api.post('/api/leads', {
      data: {
        firstName: 'PW',
        lastName: `Mtg${s}`,
        company: `PW_AUDIT_CO_MTG_${s}`,
        email: `pw.mtg.${s}@audit.test`,
        campaignId: fixture().campaignA,
        assignedToId: fixture().users.sdrA.id,
      },
    })
  );
  expect(status, `lead create failed: ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(300);
  return (body as { id: string }).id;
}

async function bookMeeting(api: APIRequestContext, leadId: string) {
  const { status, body } = await readJson(
    await api.post('/api/meetings', {
      data: {
        leadId,
        status: 'scheduled',
        title: `PW_AUDIT_MEETING_${stamp()}`,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        durationMins: 30,
        timezone: 'UTC',
      },
    })
  );
  expect(status, `meeting create failed: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);
  const meeting = (body as { meeting?: { id: string }; id?: string });
  return meeting.meeting?.id ?? meeting.id!;
}

/** Every opportunity currently visible for a lead. The count is the point. */
async function opportunitiesForLead(api: APIRequestContext, leadId: string) {
  const { status, body } = await readJson(await api.get('/api/opportunities?limit=200'));
  expect(status).toBe(200);
  const rows = (Array.isArray(body) ? body : (body as { opportunities?: unknown[] }).opportunities ?? []) as {
    id?: string;
    leadId?: string;
    status?: string;
    stage?: string;
  }[];
  return rows.filter((o) => o.leadId === leadId);
}

test.describe('meeting lifecycle', () => {
  test('a meeting can be booked, rescheduled and read back', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const leadId = await createLead(api);
    const meetingId = await bookMeeting(api, leadId);

    const moved = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { status } = await readJson(
      await api.patch(`/api/meetings/${meetingId}`, { data: { scheduledAt: moved } })
    );
    expect(status, 'reschedule failed').toBe(200);

    const reread = await readJson(await api.get(`/api/meetings/${meetingId}`));
    expect(reread.status).toBe(200);

    await api.delete(`/api/leads/${leadId}`);
    await api.dispose();
  });
});

test.describe('meeting to opportunity', () => {
  test('a qualified outcome creates exactly one opportunity for the right lead', async ({
    baseURL,
  }) => {
    const api = await apiAs('director', baseURL!);
    const leadId = await createLead(api);
    const meetingId = await bookMeeting(api, leadId);

    expect(await opportunitiesForLead(api, leadId), 'lead started with an opportunity').toHaveLength(0);

    const { status, body } = await readJson(
      await api.post(`/api/meetings/${meetingId}/outcome`, {
        data: {
          status: 'completed',
          outcome: 'qualified_opportunity',
          outcomeNotes: 'PW_AUDIT qualified',
          nextStep: 'PW_AUDIT next step',
        },
      })
    );
    expect(status, `outcome failed: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);

    // Asserting the response is not enough — read the pipeline back.
    const opps = await opportunitiesForLead(api, leadId);
    expect(opps, 'a qualified meeting produced no opportunity').toHaveLength(1);
    expect(opps[0]!.leadId).toBe(leadId);

    await api.delete(`/api/leads/${leadId}`);
    await api.dispose();
  });

  test('re-logging the same outcome does not create a second opportunity', async ({ baseURL }) => {
    // §32 requires this explicitly, and the route comments claim idempotency. Claims in
    // comments are what this audit exists to check.
    const api = await apiAs('director', baseURL!);
    const leadId = await createLead(api);
    const meetingId = await bookMeeting(api, leadId);

    const payload = {
      data: {
        status: 'completed',
        outcome: 'qualified_opportunity',
        outcomeNotes: 'PW_AUDIT qualified',
      },
    };
    await api.post(`/api/meetings/${meetingId}/outcome`, payload);
    await api.post(`/api/meetings/${meetingId}/outcome`, payload);

    expect(
      await opportunitiesForLead(api, leadId),
      're-logging a qualified outcome duplicated the opportunity'
    ).toHaveLength(1);

    await api.delete(`/api/leads/${leadId}`);
    await api.dispose();
  });

  test('two simultaneous outcome submissions still produce one opportunity', async ({
    baseURL,
    recorder,
  }) => {
    // §46 — the concurrent version of the case above. Sequential idempotency and concurrent
    // idempotency are different guarantees; a `findFirst`-then-`create` passes the first and
    // fails this one.
    recorder.expectFailures(400, 409, 422, 500);
    const api = await apiAs('director', baseURL!);
    const leadId = await createLead(api);
    const meetingId = await bookMeeting(api, leadId);

    const payload = {
      data: { status: 'completed', outcome: 'qualified_opportunity', outcomeNotes: 'PW_AUDIT race' },
    };
    await Promise.all([
      api.post(`/api/meetings/${meetingId}/outcome`, payload),
      api.post(`/api/meetings/${meetingId}/outcome`, payload),
    ]);

    expect(
      await opportunitiesForLead(api, leadId),
      'concurrent outcome submissions duplicated the opportunity'
    ).toHaveLength(1);

    await api.delete(`/api/leads/${leadId}`);
    await api.dispose();
  });

  test('a not-qualified outcome creates no opportunity', async ({ baseURL }) => {
    // The control. Without it, a route that created an opportunity for every outcome would
    // pass every test above.
    const api = await apiAs('director', baseURL!);
    const leadId = await createLead(api);
    const meetingId = await bookMeeting(api, leadId);

    const { status } = await readJson(
      await api.post(`/api/meetings/${meetingId}/outcome`, {
        // `completed_not_qualified`, not `not_qualified` — the enum is
        // `prisma/schema.prisma:134-142`. BUG-003 records the same class of mistake in the old
        // 31-step spec (`qualified` for `qualified_opportunity`), where the wrong value was
        // accepted with a 200 and created nothing while the test reported success.
        data: {
          status: 'completed',
          outcome: 'completed_not_qualified',
          outcomeNotes: 'PW_AUDIT not qualified',
        },
      })
    );
    expect(status).toBeLessThan(300);

    expect(
      await opportunitiesForLead(api, leadId),
      'a not-qualified meeting created an opportunity'
    ).toHaveLength(0);

    await api.delete(`/api/leads/${leadId}`);
    await api.dispose();
  });
});

test.describe('opportunity handoff authorization', () => {
  test('an SDR cannot approve their own client handoff', async ({ baseURL, recorder }) => {
    // `canApproveClientHandoff` (lib/opportunities/access.ts:32) permits director,
    // floor_manager and team_lead only. BUG-003 records that the old spec would have reported
    // success whether or not this held.
    recorder.expectFailures(400, 403, 404, 409, 422);
    const admin = await apiAs('director', baseURL!);
    const leadId = await createLead(admin);
    const meetingId = await bookMeeting(admin, leadId);
    await admin.post(`/api/meetings/${meetingId}/outcome`, {
      data: { status: 'completed', outcome: 'qualified_opportunity', outcomeNotes: 'PW_AUDIT handoff' },
    });
    const opps = await opportunitiesForLead(admin, leadId);
    expect(opps, 'no opportunity to hand off').toHaveLength(1);
    const oppId = opps[0]!.id!;

    const sdr = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await sdr.post(`/api/opportunities/${oppId}/handoff`, { data: { decision: 'accepted' } })
    );
    expect(status, `an SDR approved their own handoff (${status})`).toBe(403);
    await sdr.dispose();

    // Mirror: a director may.
    const approved = await readJson(
      await admin.post(`/api/opportunities/${oppId}/handoff`, { data: { decision: 'accepted' } })
    );
    expect(
      approved.status,
      `a director was refused the handoff: ${JSON.stringify(approved.body).slice(0, 200)}`
    ).toBeLessThan(300);

    await admin.delete(`/api/leads/${leadId}`);
    await admin.dispose();
  });
});
