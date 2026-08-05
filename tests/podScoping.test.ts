import { describe, it, expect } from 'vitest';
import { computeVisibleUserIds, wouldCreateManagerCycle, type OrgUser } from '@/lib/podScoping';

// director → fm1 → tl1 → sdr1, sdr2
//                → tl2 → sdr3
//          → fm2 → tl3 → sdr4
const org: OrgUser[] = [
  { id: 'director', role: 'director', managerId: null },
  { id: 'fm1', role: 'floor_manager', managerId: 'director' },
  { id: 'fm2', role: 'floor_manager', managerId: 'director' },
  { id: 'tl1', role: 'team_lead', managerId: 'fm1' },
  { id: 'tl2', role: 'team_lead', managerId: 'fm1' },
  { id: 'tl3', role: 'team_lead', managerId: 'fm2' },
  { id: 'sdr1', role: 'sdr', managerId: 'tl1' },
  { id: 'sdr2', role: 'sdr', managerId: 'tl1' },
  { id: 'sdr3', role: 'sdr', managerId: 'tl2' },
  { id: 'sdr4', role: 'sdr', managerId: 'tl3' },
];

describe('computeVisibleUserIds', () => {
  it('director sees everyone (null = unrestricted)', () => {
    expect(computeVisibleUserIds(org, { id: 'director', role: 'director' })).toBeNull();
  });

  it('floor manager sees their whole floor, not the other floor', () => {
    const ids = computeVisibleUserIds(org, { id: 'fm1', role: 'floor_manager' })!;
    expect(ids.sort()).toEqual(['fm1', 'sdr1', 'sdr2', 'sdr3', 'tl1', 'tl2']);
    expect(ids).not.toContain('sdr4');
    expect(ids).not.toContain('fm2');
  });

  it('team lead sees only their pod + self', () => {
    const ids = computeVisibleUserIds(org, { id: 'tl1', role: 'team_lead' })!;
    expect(ids.sort()).toEqual(['sdr1', 'sdr2', 'tl1']);
  });

  it('SDR sees only themself', () => {
    expect(computeVisibleUserIds(org, { id: 'sdr1', role: 'sdr' })).toEqual(['sdr1']);
  });

  it('survives a managerId cycle without infinite looping', () => {
    const cyclic: OrgUser[] = [
      { id: 'a', role: 'team_lead', managerId: 'b' },
      { id: 'b', role: 'team_lead', managerId: 'a' },
    ];
    const ids = computeVisibleUserIds(cyclic, { id: 'a', role: 'team_lead' })!;
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});

describe('wouldCreateManagerCycle', () => {
  it('rejects making a user their own manager', () => {
    expect(wouldCreateManagerCycle(org, 'sdr1', 'sdr1')).toBe(true);
  });

  it('rejects a direct two-node cycle', () => {
    // tl1 already reports to fm1; making fm1 report to tl1 closes the loop.
    expect(wouldCreateManagerCycle(org, 'fm1', 'tl1')).toBe(true);
  });

  it('rejects a three-hop cycle', () => {
    // director → fm1 → tl1; pointing director at tl1 closes a 3-hop loop.
    expect(wouldCreateManagerCycle(org, 'director', 'tl1')).toBe(true);
  });

  it('allows clearing the manager', () => {
    expect(wouldCreateManagerCycle(org, 'sdr1', null)).toBe(false);
  });

  it('allows a valid reparent to another branch', () => {
    expect(wouldCreateManagerCycle(org, 'sdr1', 'tl3')).toBe(false);
  });

  it('allows attaching to a sibling that is not an ancestor', () => {
    expect(wouldCreateManagerCycle(org, 'tl1', 'fm2')).toBe(false);
  });

  it('refuses to extend an already-corrupt chain instead of looping forever', () => {
    const corrupt: OrgUser[] = [
      { id: 'x', role: 'sdr', managerId: null },
      { id: 'a', role: 'team_lead', managerId: 'b' },
      { id: 'b', role: 'team_lead', managerId: 'a' },
    ];
    expect(wouldCreateManagerCycle(corrupt, 'x', 'a')).toBe(true);
  });

  it('treats an unknown manager id as acyclic (the FK check rejects it separately)', () => {
    expect(wouldCreateManagerCycle(org, 'sdr1', 'ghost')).toBe(false);
  });
});
