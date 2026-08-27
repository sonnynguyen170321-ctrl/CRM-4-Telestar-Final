import { describe, it, expect } from 'vitest';
import { formatPoolActionResult } from '@/lib/leadgen/actionResult';

/**
 * The pool convert endpoint answers `{ count, created, errors }` and reports per-record
 * failures in `errors` rather than throwing. The console showed only `count`, so a convert
 * where every record failed rendered as a green "Converted (0)" and the reasons were lost.
 */
describe('formatPoolActionResult', () => {
  it('reports a fully successful action as success with its count', () => {
    const result = formatPoolActionResult('Converted', { count: 3, errors: [] });

    expect(result.tone).toBe('success');
    expect(result.message).toBe('Converted (3)');
  });

  it('reports an action with no count field as success without a count', () => {
    const result = formatPoolActionResult('Assigned', {});

    expect(result.tone).toBe('success');
    expect(result.message).toBe('Assigned');
  });

  it('reports a partial failure as a warning naming how many failed', () => {
    const result = formatPoolActionResult('Converted', {
      count: 2,
      errors: [{ poolItemId: 'p1', reason: 'duplicate email' }],
    });

    expect(result.tone).toBe('warning');
    expect(result.message).toContain('Converted (2)');
    expect(result.message).toContain('1 failed');
    expect(result.message).toContain('duplicate email');
  });

  it('reports a total failure as an error, never as success', () => {
    const result = formatPoolActionResult('Converted', {
      count: 0,
      errors: [
        { poolItemId: 'p1', reason: 'no_sdr_available' },
        { poolItemId: 'p2', reason: 'no_sdr_available' },
      ],
    });

    expect(result.tone).toBe('error');
    expect(result.message).toContain('2 failed');
    expect(result.message).toContain('no SDR selected');
  });

  it('names distinct reasons rather than only the first one', () => {
    const result = formatPoolActionResult('Converted', {
      count: 0,
      errors: [
        { poolItemId: 'p1', reason: 'duplicate email' },
        { poolItemId: 'p2', reason: 'no_sdr_available' },
      ],
    });

    expect(result.message).toContain('duplicate email');
    expect(result.message).toContain('no SDR selected');
  });

  it('renders known reason codes as words a manager can act on', () => {
    const result = formatPoolActionResult('Converted', {
      count: 0,
      errors: [{ poolItemId: 'p1', reason: 'already_a_lead_in_this_campaign' }],
    });

    expect(result.message).toContain('already a lead in this campaign');
    expect(result.message).not.toContain('already_a_lead_in_this_campaign');
  });

  it('renders the no-rep reason as words too', () => {
    const result = formatPoolActionResult('Converted', {
      count: 0,
      errors: [{ poolItemId: 'p1', reason: 'no_sdr_available' }],
    });

    expect(result.message).toContain('no SDR selected');
  });

  it('passes through a reason it has no wording for', () => {
    const result = formatPoolActionResult('Converted', {
      count: 0,
      errors: [{ poolItemId: 'p1', reason: 'database exploded' }],
    });

    expect(result.message).toContain('database exploded');
  });

  it('survives a response shape it does not recognise', () => {
    const result = formatPoolActionResult('Assigned', null);

    expect(result.tone).toBe('success');
    expect(result.message).toBe('Assigned');
  });
});
