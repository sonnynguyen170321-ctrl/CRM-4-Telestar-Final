import { describe, it, expect } from 'vitest';
import { isAwaitingConversion } from '@/lib/leadgen/poolItemState';

/**
 * "Assign to Campaign / SDR" writes `assignedSdrId` on the pool record and nothing else —
 * no `Lead` row is created, so the SDR's lead space (which reads `Lead`) stays empty until
 * the record is converted. The console rendered assigned and converted records identically,
 * which is how an assignment can look complete while the rep never receives the prospect.
 */
describe('isAwaitingConversion', () => {
  it('is true for a record routed to an SDR but never converted', () => {
    expect(isAwaitingConversion({ assignedSdrId: 'sdr-1', assignedCampaignId: null, convertedLeadId: null })).toBe(true);
  });

  it('is true for a record routed to a campaign but never converted', () => {
    expect(isAwaitingConversion({ assignedSdrId: null, assignedCampaignId: 'camp-1', convertedLeadId: null })).toBe(true);
  });

  it('is false once the record has become a Lead', () => {
    expect(isAwaitingConversion({ assignedSdrId: 'sdr-1', assignedCampaignId: 'camp-1', convertedLeadId: 'lead-1' })).toBe(false);
  });

  it('is false for an untouched record — nothing was promised to anyone', () => {
    expect(isAwaitingConversion({ assignedSdrId: null, assignedCampaignId: null, convertedLeadId: null })).toBe(false);
  });
});
