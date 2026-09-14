import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/prisma';

/**
 * New users start in the company's timezone, not UTC.
 *
 * Every existing user was "UTC" because that was the schema default and nobody ever saved the
 * Settings form. A UTC assignee makes a Singapore prospect's 09:00–17:00 send window run
 * 16:00–00:00 their time. Migration 20260915000000 moves the default and the existing rows.
 */
const T = `tzdef-${crypto.randomUUID().slice(0, 8)}`;

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: T } });
});

describe('User.timezone default', () => {
  it('is Asia/Ho_Chi_Minh when not supplied', async () => {
    await prisma.tenant.create({ data: { id: T, name: T } });
    const u = await prisma.user.create({
      data: { email: `a@${T}.test`, password: 'x', firstName: 'A', lastName: 'B', role: 'sdr', tenantId: T },
      select: { timezone: true },
    });
    expect(u.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('the migration file moves existing UTC rows and says why', () => {
    const sql = readFileSync('prisma/migrations/20260915000000_user_timezone_default_ho_chi_minh/migration.sql', 'utf8');
    expect(sql).toMatch(/SET DEFAULT 'Asia\/Ho_Chi_Minh'/);
    expect(sql).toMatch(/UPDATE "User" SET "timezone" = 'Asia\/Ho_Chi_Minh' WHERE "timezone" = 'UTC'/);
    expect(sql).toMatch(/send window/i);
  });
});
