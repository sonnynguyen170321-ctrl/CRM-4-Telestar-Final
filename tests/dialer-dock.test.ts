import { describe, expect, it, vi } from 'vitest';

import { createDialerDock, isDialerHiddenPath, isDialerShortcut, isTypingTarget } from '@/lib/telephony/dialerDock';
import { fetchCallerIds, searchTargets } from '@/lib/telephony/dialerClient';
import { requestCall } from '@/lib/telephony/softphoneFlow';
import { targetFromLead } from '@/lib/telephony/dialerTargets';

/** The docked dialer's store, shortcut, hidden pages and client fetchers. */

const target = targetFromLead({ id: 'l1', firstName: 'Ann', lastName: 'Lee', phone: '0948200638' });

describe('dialer dock store', () => {
  it('opens with a preselected target and a new seq each time', () => {
    const dock = createDialerDock();
    dock.open({ target, ownPhoneLeadId: 'l1' });
    const first = dock.getState();
    expect(first).toMatchObject({ open: true, collapsed: false });
    expect(first.request).toMatchObject({ target, ownPhoneLeadId: 'l1', resumeCallId: null });
    dock.open({ resumeCallId: 'c1' });
    expect(dock.getState().request?.seq).toBeGreaterThan(first.request!.seq);
    expect(dock.getState().request).toMatchObject({ resumeCallId: 'c1', target: null });
  });

  it('toggle opens when closed, then folds and unfolds', () => {
    const dock = createDialerDock();
    dock.toggle();
    expect(dock.getState().open).toBe(true);
    dock.toggle();
    expect(dock.getState().collapsed).toBe(true);
    dock.toggle();
    expect(dock.getState().collapsed).toBe(false);
  });

  it('closes, ignores collapse while closed, and notifies subscribers until they leave', () => {
    const dock = createDialerDock();
    const listener = vi.fn();
    const off = dock.subscribe(listener);
    dock.setCollapsed(true);
    expect(listener).not.toHaveBeenCalled();
    dock.open();
    dock.close();
    expect(dock.getState()).toEqual({ open: false, collapsed: false, request: null });
    const calls = listener.mock.calls.length;
    off();
    dock.open();
    expect(listener.mock.calls.length).toBe(calls);
  });
});

describe('Alt+Shift+D and hidden pages', () => {
  const key = (over: Partial<Parameters<typeof isDialerShortcut>[0]>) => ({ altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, code: 'KeyD', key: 'd', ...over });
  it('matches only Alt+Shift+D', () => {
    expect(isDialerShortcut(key({}))).toBe(true);
    expect(isDialerShortcut(key({ altKey: false }))).toBe(false);
    expect(isDialerShortcut(key({ shiftKey: false }))).toBe(false); // plain Alt+D is the address bar
    expect(isDialerShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isDialerShortcut(key({ metaKey: true }))).toBe(false);
    expect(isDialerShortcut(key({ code: 'KeyK', key: 'k' }))).toBe(false);
  });
  it('stays out of inputs, selects, textareas and editors', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
  it('is hidden on login and the public client-report link only', () => {
    expect(isDialerHiddenPath('/login')).toBe(true);
    expect(isDialerHiddenPath('/client-reports/public/abc')).toBe(true);
    expect(isDialerHiddenPath('/leads')).toBe(false);
    expect(isDialerHiddenPath(null)).toBe(false);
  });
});

describe('targetFromLead', () => {
  it('reads the dialable number and carries do-not-call', () => {
    expect(target).toMatchObject({ leadId: 'l1', contactId: null, phone: '+84948200638', doNotCall: false });
    expect(targetFromLead({ id: 'l2', firstName: 'B', lastName: 'C', tags: ['do_not_call'] })).toMatchObject({ doNotCall: true, phone: null });
  });
});

const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('dialer client', () => {
  it('searchTargets skips a short query and reports failures instead of an empty list', async () => {
    const fetchImpl = respond(200, { targets: [] });
    expect(await searchTargets('a', { fetchImpl })).toEqual({ ok: true, targets: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await searchTargets('ann', { fetchImpl: respond(429, {}) })).toMatchObject({ ok: false });
    expect(await searchTargets('ann', { fetchImpl: respond(500, {}) })).toMatchObject({ ok: false });
    expect(await searchTargets('ann', { fetchImpl: vi.fn(async () => { throw new Error('offline'); }) })).toMatchObject({ ok: false });
    expect(await searchTargets('ann', { fetchImpl: respond(200, { targets: [target] }) })).toEqual({ ok: true, targets: [target] });
  });

  it('fetchCallerIds reports a failed load', async () => {
    expect(await fetchCallerIds(respond(200, { numbers: [] }))).toEqual({ ok: true, numbers: [] });
    expect(await fetchCallerIds(respond(403, {}))).toMatchObject({ ok: false });
  });

  it('requestCall sends fromNumberId only when chosen and explains a refused one', async () => {
    const fetchImpl = respond(201, { allowed: true, callId: 'c', toE164: '+1', clientState: 'x' });
    await requestCall({ leadId: 'l1', fromNumberId: 'n1', fetchImpl });
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ leadId: 'l1', fromNumberId: 'n1' });
    const plain = respond(201, { allowed: true, callId: 'c', toE164: '+1', clientState: 'x' });
    await requestCall({ leadId: 'l1', fetchImpl: plain });
    expect(JSON.parse((plain.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ leadId: 'l1' });
    const refused = await requestCall({ leadId: 'l1', fromNumberId: 'bad', fetchImpl: respond(400, { code: 'invalid_from_number' }) });
    expect(refused).toMatchObject({ kind: 'error', error: { message: expect.stringContaining('caller ID') } });
  });
});
