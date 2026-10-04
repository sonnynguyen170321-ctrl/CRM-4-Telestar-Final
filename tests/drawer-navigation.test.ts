import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { neighbours } from '@/components/shared/DrawerNavigation';

/**
 * Previous / next in the detail drawers. The browser behaviour is pinned by
 * e2e/leads/drawer-navigation.spec.ts; these pin the list arithmetic and the wiring a refactor
 * could silently drop.
 */

describe('neighbours', () => {
  const ids = ['a', 'b', 'c'];

  it('gives the position and both neighbours inside the list', () => {
    expect(neighbours(ids, 'b')).toEqual({ position: 2, previousId: 'a', nextId: 'c' });
  });

  it('has no previous at the start and no next at the end', () => {
    expect(neighbours(ids, 'a')).toMatchObject({ previousId: null, nextId: 'b' });
    expect(neighbours(ids, 'c')).toMatchObject({ previousId: 'b', nextId: null });
  });

  it('keeps moving when the open record has just left the list', () => {
    // 'b' was second; completing its task removed it, so 'c' moved up into its slot.
    expect(neighbours(['a', 'c'], 'b', 1)).toEqual({ position: null, previousId: 'a', nextId: 'c' });
    // It was last; there is no next, and the new last is previous.
    expect(neighbours(['a', 'b'], 'c', 2)).toEqual({ position: null, previousId: 'b', nextId: null });
  });

  it('offers nothing for a record that was never in the list', () => {
    expect(neighbours(ids, 'z')).toEqual({ position: null, previousId: null, nextId: null });
  });
});

describe('wiring', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('mounts the lead drawer body fresh for each lead, so no draft survives a step', () => {
    expect(read('components/LeadDetailPanel.tsx')).toMatch(/<LeadDetailPanelBody\s+key=\{leadId\}/);
  });

  it('gives every list page that opens the lead drawer its list', () => {
    for (const page of ['app/leads/page.tsx', 'app/leadgen/page.tsx', 'app/meetings/page.tsx', 'app/page.tsx', 'app/director/page.tsx']) {
      const source = read(page);
      expect(source, `${page} does not pass siblingIds`).toMatch(/siblingIds=\{/);
      expect(source, `${page} does not pass onNavigate`).toMatch(/onNavigate=\{/);
    }
  });

  it('turns previous / next off while a composer, call or form is open in the drawer', () => {
    const source = read('components/LeadDetailPanel.tsx');
    expect(source).toMatch(/useDrawerNavigation\(\{[^}]*disabled: busy/);
    const busy = source.match(/const busy =([^;]*);/)?.[1] ?? '';
    for (const flag of ['showComposer', 'showDialer', 'showBookingModal', 'showTaskForm', 'showLogActivity']) {
      expect(busy, `${flag} does not lock navigation`).toMatch(new RegExp(String.raw`\b${flag}\b`));
    }
  });

  it('opens every Leadgen view through the list it came from', () => {
    const source = read('app/leadgen/page.tsx');
    expect(source).not.toMatch(/onSelectLead=\{setSelectedLeadId\}/);
    expect(source).not.toMatch(/onClick=\{\(\) => setSelectedLeadId\(/);
  });

  it('lets the drawer own j / k on the leads page while it is open', () => {
    expect(read('app/leads/page.tsx')).toMatch(/if \(selectedLeadId\) return;/);
  });

  it('ignores a candidate load that answers after the person moved on', () => {
    expect(read('components/research/ResearchCandidateDrawer.tsx')).toMatch(/if \(isCurrent\(\)\) setDetail\(body\)/);
  });
});
