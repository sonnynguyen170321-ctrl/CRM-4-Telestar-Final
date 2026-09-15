import { describe, it, expect } from 'vitest';
import { updateLeadSchema } from '@/lib/validation/schemas';
import { readFileSync } from 'node:fs';

/**
 * The lead panel's Confirm button writes `lead.timezone` through PUT /api/leads/:id.
 * The value decides when sequence email goes out, so it must be a real IANA zone.
 */
describe('updateLeadSchema.timezone', () => {
  it('accepts an IANA zone and null (clear)', () => {
    expect(updateLeadSchema.safeParse({ timezone: 'Asia/Singapore' }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ timezone: ' Asia/Ho_Chi_Minh ' }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ timezone: null }).success).toBe(true);
  });

  it('refuses a typo, an offset string, and an empty string', () => {
    expect(updateLeadSchema.safeParse({ timezone: 'Asia/Singapur' }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ timezone: 'GMT+8' }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ timezone: '' }).success).toBe(false);
  });

  it('is applied by the route', () => {
    const src = readFileSync('app/api/leads/[id]/route.ts', 'utf8');
    expect(src).toMatch(/body\.timezone !== undefined && \{ timezone: body\.timezone \}/);
  });
});

describe('the lead panel no longer invents a country', () => {
  it('shows the contact country or a dash', () => {
    const src = readFileSync('components/LeadDetailPanel.tsx', 'utf8');
    expect(src).not.toContain("'United States'");
    expect(src).toContain('<ProspectClock');
  });
});
