import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

describe('Safe Production Cutover Tool & Roster Verification', () => {
  it('approved roster is valid JSON with active director account', () => {
    const rosterPath = path.join(process.cwd(), 'scripts', 'cutover', 'approved-roster.json');
    expect(existsSync(rosterPath)).toBe(true);
    const data = JSON.parse(readFileSync(rosterPath, 'utf8'));
    expect(data.approvedUsers).toBeDefined();
    expect(data.approvedUsers.length).toBeGreaterThan(0);
    const director = data.approvedUsers.find((u: any) => u.role === 'director');
    expect(director).toBeDefined();
    expect(director.email).toBe('sonnynguyenofficial@gmail.com');
  });

  it('safe-cutover-tool script exists and has PLAN, VERIFY, and EXECUTE mode handlers', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'cutover', 'safe-cutover-tool.ts');
    expect(existsSync(scriptPath)).toBe(true);
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('planMode');
    expect(content).toContain('verifyMode');
    expect(content).toContain('executeMode');
    expect(content).toContain('confirm-production-destructive-cutover');
  });
});
