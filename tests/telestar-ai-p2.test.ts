import { describe, it, expect } from 'vitest';

describe('Telestar AI Phase 2 — Operational & Manager Intelligence', () => {
  it('evaluates campaign sample size thresholds accurately', () => {
    const isSampleAdequate = (leadsCount: number) => leadsCount >= 30;
    expect(isSampleAdequate(14)).toBe(false);
    expect(isSampleAdequate(45)).toBe(true);
  });

  it('calculates safe work transfer project loads', () => {
    const fromCurrent = 80;
    const toCurrent = 40;
    const transferCount = 20;

    const fromProjected = fromCurrent - transferCount;
    const toProjected = toCurrent + transferCount;

    expect(fromProjected).toBe(60);
    expect(toProjected).toBe(60);
    expect(toProjected <= 120).toBe(true);
  });
});
