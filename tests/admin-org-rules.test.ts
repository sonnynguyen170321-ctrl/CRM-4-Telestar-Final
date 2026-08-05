import { describe, it, expect } from 'vitest';
import {
  isValidManagerRole,
  describeManagerRoleRule,
  canOwnSdrWork,
  WORK_OWNER_ROLES,
} from '@/lib/admin/orgRules';

describe('isValidManagerRole', () => {
  it('lets an SDR report to a team lead, floor manager or director', () => {
    expect(isValidManagerRole('sdr', 'team_lead')).toBe(true);
    expect(isValidManagerRole('sdr', 'floor_manager')).toBe(true);
    expect(isValidManagerRole('sdr', 'director')).toBe(true);
  });

  it('rejects an SDR managing anyone', () => {
    expect(isValidManagerRole('sdr', 'sdr')).toBe(false);
    expect(isValidManagerRole('team_lead', 'sdr')).toBe(false);
    expect(isValidManagerRole('floor_manager', 'sdr')).toBe(false);
  });

  it('rejects inverting the SDR-org hierarchy', () => {
    expect(isValidManagerRole('floor_manager', 'team_lead')).toBe(false);
    expect(isValidManagerRole('team_lead', 'team_lead')).toBe(false);
  });

  it('keeps the leadgen branch separate from the SDR branch', () => {
    expect(isValidManagerRole('leadgen', 'leadgen_manager')).toBe(true);
    expect(isValidManagerRole('leadgen', 'team_lead')).toBe(false);
    expect(isValidManagerRole('leadgen', 'floor_manager')).toBe(false);
    expect(isValidManagerRole('sdr', 'leadgen_manager')).toBe(false);
  });

  it('gives a director no valid manager — they top the chain', () => {
    for (const role of ['director', 'floor_manager', 'team_lead', 'sdr', 'leadgen', 'leadgen_manager'] as const) {
      expect(isValidManagerRole('director', role)).toBe(false);
    }
    expect(describeManagerRoleRule('director')).toContain('cannot have a manager');
  });

  it('describes the rule in terms a director can act on', () => {
    expect(describeManagerRoleRule('sdr')).toContain('team_lead');
  });
});

describe('canOwnSdrWork', () => {
  it('allows the SDR-org roles that actually work a queue', () => {
    expect(canOwnSdrWork('sdr')).toBe(true);
    expect(canOwnSdrWork('team_lead')).toBe(true);
    expect(canOwnSdrWork('floor_manager')).toBe(true);
  });

  // Leadgen users are scoped by campaign, not by assignee — a lead handed to
  // one vanishes from every user-axis queue.
  it('refuses leadgen roles as work owners', () => {
    expect(canOwnSdrWork('leadgen')).toBe(false);
    expect(canOwnSdrWork('leadgen_manager')).toBe(false);
  });

  it('exposes the same set used for the transfer-work error message', () => {
    expect([...WORK_OWNER_ROLES].sort()).toEqual(['floor_manager', 'sdr', 'team_lead']);
  });
});
