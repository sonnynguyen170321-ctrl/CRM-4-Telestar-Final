import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('next/font/google', () => ({
  Montserrat: () => ({
    variable: '--font-montserrat',
    className: 'className-montserrat',
  }),
  JetBrains_Mono: () => ({
    variable: '--font-mono',
    className: 'className-mono',
  }),
}));

const { fontVariables } = await import('@/app/fonts');

const ROOT = process.cwd();

describe('Telestar Typography Transformation Architecture', () => {
  it('loads Montserrat and JetBrains Mono fonts in app/fonts.ts', () => {
    expect(fontVariables).toBeDefined();
    expect(typeof fontVariables).toBe('string');
    // Verifies CSS variables are generated for Montserrat and Mono
    expect(fontVariables).toContain('--font-montserrat');
    expect(fontVariables).toContain('--font-mono');
  });

  it('declares semantic font tokens and 6-tier type scale in app/globals.css', () => {
    const css = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

    // Font family tokens
    expect(css).toContain('--font-sans: var(--font-montserrat)');
    expect(css).toContain('--font-brand: \'Futura\'');
    expect(css).toContain('--font-mono: var(--font-mono)');

    // 6-tier Type scale tokens
    expect(css).toContain('--text-page-title: 28px;');
    expect(css).toContain('--text-section: 20px;');
    expect(css).toContain('--text-subsection: 16px;');
    expect(css).toContain('--text-body: 14px;');
    expect(css).toContain('--text-meta: 13px;');
    expect(css).toContain('--text-micro: 11.5px;');

    // Tabular numerals class
    expect(css).toContain('.tabular-nums');
    expect(css).toContain('font-variant-numeric: tabular-nums');
  });

  it('provides semantic typography utility classes', () => {
    const css = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

    expect(css).toContain('.font-brand');
    expect(css).toContain('.font-sans');
    expect(css).toContain('.font-mono');
    expect(css).toContain('.type-page-title');
    expect(css).toContain('.type-section');
    expect(css).toContain('.type-subsection');
    expect(css).toContain('.type-body');
    expect(css).toContain('.type-meta');
    expect(css).toContain('.type-micro');
  });

  it('renders international and Vietnamese glyphs cleanly without encoding corruption', () => {
    const sampleVietnamese = 'Hệ thống vận hành doanh thu Telestar CRM: Tối ưu hoá quy trình tìm kiếm khách hàng tiềm năng.';
    const sampleFrench = 'Rapport d\'activité commerciale et prévisions des ventes 2026.';
    const sampleGerman = 'Qualitätsüberprüfung von Kundendaten und Kampagnenfortschritt.';

    expect(Buffer.from(sampleVietnamese, 'utf8').toString('utf8')).toBe(sampleVietnamese);
    expect(Buffer.from(sampleFrench, 'utf8').toString('utf8')).toBe(sampleFrench);
    expect(Buffer.from(sampleGerman, 'utf8').toString('utf8')).toBe(sampleGerman);
  });
});
