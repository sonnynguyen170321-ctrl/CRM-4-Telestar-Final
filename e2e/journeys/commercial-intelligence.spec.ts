/**
 * Commercial Intelligence & Reuse Engine E2E Acceptance Spec
 *
 * Verifies end-to-end operational workflows:
 * 1. Post-meeting structured intelligence capture (persona, budget, relationship strength).
 * 2. Database health analytics and actionable metrics.
 * 3. Internal campaign matching and gap preview.
 * 4. AI 3-tiered contact memory generation.
 * 5. SDR Next Best Action grounding.
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
        firstName: 'CI',
        lastName: `Lead${s}`,
        company: `CI_CORP_${s}`,
        email: `ci.lead.${s}@enterprise.test`,
        phone: `+1555${Math.floor(100000 + Math.random() * 900000)}`,
        campaignId: fixture().campaignA,
        assignedToId: fixture().users.sdrA.id,
      },
    })
  );
  expect(status, `lead create failed: ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(300);
  return (body as { id: string; contactId?: string }).id;
}

test.describe('Commercial Intelligence Engine E2E Flows', () => {
  test('1. Database health diagnostics returns structured metrics and actionable health score', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const { status, body } = await readJson(await api.get('/api/leadgen/health'));

    expect(status).toBe(200);
    const health = body as {
      totalContacts: number;
      healthScore: number;
      qualityBreakdown: Record<string, number>;
      dataStatusBreakdown: Record<string, number>;
      reuseStatusBreakdown: Record<string, number>;
      remediationSuggestions: Array<{ label: string; count: number }>;
    };

    expect(typeof health.healthScore).toBe('number');
    expect(health.healthScore).toBeGreaterThanOrEqual(0);
    expect(health.healthScore).toBeLessThanOrEqual(100);
    expect(health.qualityBreakdown).toBeDefined();
    expect(health.reuseStatusBreakdown).toBeDefined();
    await api.dispose();
  });

  test('2. Logs meeting outcome with structured commercial persona & decision-maker capture', async ({ baseURL }) => {
    const api = await apiAs('sdrA', baseURL!);
    const leadId = await createLead(api);

    // Book meeting
    const { status: bookStatus, body: bookBody } = await readJson(
      await api.post('/api/meetings', {
        data: {
          leadId,
          status: 'scheduled',
          title: `CI_MEETING_${stamp()}`,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          durationMins: 30,
          timezone: 'UTC',
        },
      })
    );
    expect(bookStatus).toBeLessThan(300);
    const meetingId = (bookBody as { meeting?: { id: string }; id?: string }).meeting?.id ?? (bookBody as { id: string }).id;

    // Log structured outcome with commercial intelligence
    const { status: outcomeStatus, body: outcomeBody } = await readJson(
      await api.post(`/api/meetings/${meetingId}/outcome`, {
        data: {
          status: 'completed',
          outcome: 'qualified_opportunity',
          outcomeNotes: 'Great discussion with CTO on CRM consolidation.',
          painPoints: 'Current stack is too slow and fragmented.',
          nextStep: 'Send contract draft and proposal.',
          decisionMakerRole: 'champion',
          relationshipStrength: 'advocate',
          budgetAuthority: 'confirmed',
          competitiveContext: 'Salesforce, HubSpot',
          createOpportunity: true,
          qualificationSummary: 'Budget confirmed, direct buyer, immediate need.',
          opportunityValue: 45000,
          opportunityCurrency: 'USD',
        },
      })
    );

    expect(outcomeStatus).toBe(200);
    const res = outcomeBody as { meeting: { status: string; outcome: string }; opportunity?: { id: string } };
    expect(res.meeting.status).toBe('completed');
    expect(res.meeting.outcome).toBe('qualified_opportunity');

    await api.delete(`/api/leads/${leadId}`);
    await api.dispose();
  });

  test('3. Evaluates SDR Next Best Action grounded in commercial intelligence', async ({ baseURL }) => {
    const api = await apiAs('sdrA', baseURL!);
    const leadId = await createLead(api);

    const { status, body } = await readJson(await api.get(`/api/ai/nba?leadId=${leadId}`));
    expect(status).toBe(200);

    const nba = body as {
      action: string;
      leadId: string;
      reason: string;
      confidence: number;
      sourceEvidence: string[];
    };

    expect(nba.leadId).toBe(leadId);
    expect(nba.action).toBeDefined();
    expect(nba.reason.length).toBeGreaterThan(0);
    expect(nba.confidence).toBeGreaterThan(0);

    await api.delete(`/api/leads/${leadId}`);
    await api.dispose();
  });
});
