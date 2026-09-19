/**
 * Things the 2026-09-19 role-play found by using the app as six people, none of which a unit
 * test on any one module would have caught, pinned at the source level so they stay fixed.
 *
 *  - Two modals had no `role="dialog"`. Assistive tech saw a form appear mid-page with no name
 *    and no boundary, while the other modals were fine — inconsistency, not policy.
 *  - The toast stack had no live region, so every confirmation was silent to a screen reader;
 *    and it shared bottom-right with the AI Copilot launcher, so the two overlapped.
 *  - Leadgen roles could open the SDR environment (`/leads`, `/inbox`, `/sequences`…) by URL
 *    although no link offered it. Data was scoped, so nothing leaked; but a page that exists
 *    for a role only when they guess its address is neither offered nor refused.
 *  - A leadgen with no reports got a red "Console Blocked" card on their own Settings page,
 *    from a 403 the panel fired to find out whether they manage anyone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('every modal declares itself', () => {
  it('the call-logging modal on the dashboard is a dialog', () => {
    const src = read('app', 'page.tsx');
    const at = src.indexOf('Call / Activity Logging Modal');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 900);
    expect(block).toMatch(/role="dialog"/);
    expect(block).toMatch(/aria-modal="true"/);
    expect(block).toMatch(/aria-label=/);
  });

  it('the meeting booking modal is a dialog', () => {
    const src = read('components', 'meetings', 'MeetingBookingModal.tsx');
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/aria-label=\{`Book meeting with/);
  });
});

describe('toasts are announced and do not sit on the Copilot launcher', () => {
  const toasts = read('context', 'ToastContext.tsx');
  const copilot = read('components', 'AiAssistant.tsx');

  it('the stack is a polite live region', () => {
    expect(toasts).toMatch(/role="status"/);
    expect(toasts).toMatch(/aria-live="polite"/);
  });

  it('the stack is lifted above the launcher, which keeps bottom-6', () => {
    expect(copilot).toMatch(/fixed bottom-6 right-6/);
    expect(toasts).toMatch(/fixed bottom-24 right-6/);
    expect(toasts).not.toMatch(/fixed bottom-6 right-6/);
  });
});

describe('the leadgen environment is a boundary, not a menu', () => {
  const shell = read('components', 'DashboardShell.tsx');
  const sidebar = read('components', 'Sidebar.tsx');

  it('the shell sends leadgen roles home from SDR-environment routes', () => {
    expect(shell).toMatch(/SDR_ENVIRONMENT_PREFIXES/);
    for (const route of ['/leads', '/inbox', '/sequences', '/templates', '/meetings', '/opportunities']) {
      expect(shell, `${route} is not in the boundary`).toContain(`'${route}'`);
    }
    expect(shell).toMatch(/leadgen: '\/leadgen', leadgen_manager: '\/leadgen-manager'/);
  });

  it('none of those routes is offered in the leadgen sidebar branch', () => {
    // The leadgen branch is the first `isLeadgenUser(userRole)` block; the SDR routes must
    // not appear inside it, or the boundary above would bounce a link the menu offers.
    const start = sidebar.indexOf('isLeadgenUser(userRole)');
    const end = sidebar.indexOf('label: \'Overview\'', start);
    const branch = sidebar.slice(start, end > start ? end : start + 4000);
    for (const route of ['/leads\'', '/inbox\'', '/sequences\'', '/templates\'', '/meetings\'', '/opportunities\'']) {
      expect(branch, `leadgen branch offers ${route}`).not.toContain(`href: '${route}`);
    }
  });
});

describe('a settings panel that does not apply is absent, not refused', () => {
  const panel = read('components', 'settings', 'TeamAccountsPanel.tsx');
  const settings = read('app', 'settings', 'page.tsx');

  it('renders nothing on a 403, heading included', () => {
    expect(panel).toMatch(/if \(blocked\) return null;/);
    expect(panel).not.toMatch(/Console Blocked/);
    // The heading travels with the panel, so it cannot outlive it.
    expect(settings).toMatch(/<TeamAccountsPanel\s+frame=/);
  });
});
