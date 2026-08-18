import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/tenant-context', () => ({
  tenantStorage: {
    run: vi.fn((_ctx, fn) => fn()),
  },
}));

vi.mock('@/lib/ai/engine/attention-engine', () => ({
  getWhatNeedsAttention: vi.fn().mockResolvedValue({
    role: 'sdr',
    totalItems: 1,
    criticalCount: 0,
    items: [
      {
        id: 'overdue_1',
        category: 'overdue_task',
        severity: 'high',
        title: 'Overdue follow-up with John Doe',
        summary: 'ACME task overdue',
        reason: 'SLA breach',
        evidence: 'nextTaskDue in past',
        targetUrl: '/leads/123',
        actionLabel: 'Open Lead',
        dedupeKey: 'overdue_123',
        createdAt: new Date(),
      },
    ],
    quietnessStatus: 'active_signals',
  }),
}));

vi.mock('@/lib/ai/engine/next-best-action', () => ({
  calculateNextBestAction: vi.fn().mockResolvedValue({
    action: 'REPLY',
    leadId: 'lead_123',
    leadName: 'Jane Smith',
    company: 'TechCorp',
    priority: 'hot',
    reason: 'Prospect replied to outreach',
    deadline: new Date(),
    confidence: 0.98,
    sourceEvidence: ['Stage is replied.'],
  }),
}));

describe('Telestar AI UI Integration API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/ai/attention returns attention report for authenticated user', async () => {
    const { requireAuth } = await import('@/lib/auth');
    (requireAuth as any).mockResolvedValue({
      id: 'usr_1',
      role: 'sdr',
      tenantId: 'tenant_1',
      email: 'sdr@telestar.ai',
    });

    const { GET } = await import('@/app/api/ai/attention/route');
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalItems).toBe(1);
    expect(body.items[0].id).toBe('overdue_1');
  });

  it('GET /api/ai/nba requires leadId param', async () => {
    const { requireAuth } = await import('@/lib/auth');
    (requireAuth as any).mockResolvedValue({
      id: 'usr_1',
      role: 'sdr',
      tenantId: 'tenant_1',
    });

    const { GET } = await import('@/app/api/ai/nba/route');
    const req = new NextRequest('http://localhost:3000/api/ai/nba');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('GET /api/ai/nba returns next best action for valid leadId', async () => {
    const { requireAuth } = await import('@/lib/auth');
    (requireAuth as any).mockResolvedValue({
      id: 'usr_1',
      role: 'sdr',
      tenantId: 'tenant_1',
    });

    const { GET } = await import('@/app/api/ai/nba/route');
    const req = new NextRequest('http://localhost:3000/api/ai/nba?leadId=lead_123');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.action).toBe('REPLY');
    expect(body.leadId).toBe('lead_123');
    expect(body.confidence).toBe(0.98);
  });
});
