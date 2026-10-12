/**
 * Lead detail is a slide-over; `app/leads/[id]` does not exist. A link or router.push to
 * `/leads/<id>` is a dead anchor (404 on prefetch and on click). UI code must go through
 * `openLeadSlideOver` (`lib/leads/openLead.ts`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leadIdFromLink } from '@/lib/leads/openLead';

const DEAD_TARGET = /(?:href|push|replace|redirect)\s*[=(]\s*\{?\s*[`'"]\/leads\/[^?'"`\s]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'api') return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('no dead /leads/<id> navigation in the UI', () => {
  it('has no page for a lead id', () => {
    expect(() => statSync(join(process.cwd(), 'app/leads/[id]/page.tsx'))).toThrow();
  });

  it('no href or router call in app/ or components/ targets /leads/<id>', () => {
    const offenders = ['app', 'components']
      .flatMap((root) => sourceFiles(join(process.cwd(), root)))
      .filter((file) => DEAD_TARGET.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(process.cwd().length + 1));
    expect(offenders).toEqual([]);
  });

  it('leadIdFromLink reads the id out of a stored link', () => {
    expect(leadIdFromLink('/leads/abc-123')).toBe('abc-123');
    expect(leadIdFromLink('/leads/abc?tab=notes')).toBe('abc');
    expect(leadIdFromLink('/leads')).toBeNull();
    expect(leadIdFromLink('/inbox')).toBeNull();
    expect(leadIdFromLink(null)).toBeNull();
  });
});
