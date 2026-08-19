import { describe, it, expect } from 'vitest';
import { poolItemsToCsv } from '@/lib/leadgen/pool';
import { exportReportToCSV } from '@/lib/client-reports/exporters';
import { stripHtml } from '@/lib/email/sanitize';

describe('SEC-009: CSV Formula Injection Prevention (CWE-1236)', () => {
  it('prefixes dangerous formula starting characters with single quote in pool export', () => {
    const maliciousItems = [
      {
        firstName: '=cmd|"/C calc"!A0',
        lastName: '+2+5',
        company: '-DANGEROUS_CMD',
        title: '@SUM(1,2)',
        email: '\tmalicious@tab.test',
        phone: '+1234567890',
        linkedIn: null,
        website: null,
        country: null,
        industry: null,
        status: 'imported',
        qualification: 'unreviewed',
        sourceType: 'manual',
        sourceName: null,
        icpFitScore: null,
        dataQualityScore: null,
        emailValidation: null,
        emailScore: null,
      },
    ];

    const csv = poolItemsToCsv(maliciousItems);
    const lines = csv.split('\n');
    const dataLine = lines[1];

    expect(dataLine).toContain("\"'=cmd|\"\"/C calc\"\"!A0\"");
    expect(dataLine).toContain("'+2+5");
    expect(dataLine).toContain("'-DANGEROUS_CMD");
    expect(dataLine).toContain("\"'@SUM(1,2)\"");
    expect(dataLine).toContain("'\tmalicious@tab.test");
  });

  it('prefixes dangerous formula starting characters in client report CSV export', () => {
    const maliciousSnapshot = {
      meta: {
        clientName: '=HYPERLINK("http://evil.com","Click Me")',
        campaignName: '+100',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        generatedByName: '@Admin',
        approvedByName: '-Manager',
        createdAt: '2026-08-16',
      },
      insights: {
        summary: '=cmd|calc',
        keyWins: ['+Win1'],
        blockers: ['-Blocker1'],
        recommendations: ['@Rec1'],
        clientActions: ['=Action1'],
      },
      kpis: {
        totalLeadsAssigned: 10,
        newLeadsAdded: 5,
        leadsTouched: 8,
        touchpointsCompleted: 12,
        replies: 2,
        replyRate: 0.25,
        meetingsBooked: 1,
        meetingsCompleted: 1,
        noShows: 0,
        qualifiedMeetings: 1,
        opportunitiesSubmitted: 1,
        clientAcceptedOpportunities: 1,
        clientAcceptanceRate: 1.0,
        activePipelineValue: 50000,
        wonValue: 0,
      },
      sdrs: [],
      campaigns: [],
      channels: [],
      meetings: [],
      opportunities: [],
      reps: [],
      deliverability: {
        domainsHealthy: 1,
        domainsWarning: 0,
        domainsFailing: 0,
        overallScore: 98,
        healthLevel: 'healthy',
      },
    };

    const csv = exportReportToCSV(maliciousSnapshot as never);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil.com\"\",\"\"Click Me\"\")\"");
    expect(csv).toContain("\"'+100\"");
    expect(csv).toContain("\"'@Admin\"");
    expect(csv).toContain("\"'-Manager\"");
    expect(csv).toContain("\"'=cmd|calc\"");
  });
});

describe('SEC-010: Inbound Email XSS & Dangerous HTML Stripping', () => {
  it('strips script tags and executable payloads from HTML email bodies', () => {
    const maliciousHtml = '<p>Hello</p><script>alert("XSS")</script><iframe src="javascript:alert(1)"></iframe><b>Bold</b>';
    const clean = stripHtml(maliciousHtml);
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('</script>');
    expect(clean).not.toContain('<iframe>');
    expect(clean).toContain('Hello');
    expect(clean).toContain('Bold');
  });

  it('handles nested and malformed tags safely', () => {
    const dirty = '<a href="javascript:eval(\'evil\')">Click</a><img src="x" onerror="alert(1)">';
    const clean = stripHtml(dirty);
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('onerror');
  });
});
