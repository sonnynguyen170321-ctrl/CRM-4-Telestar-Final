import { describe, expect, it } from 'vitest';

import {
  AUTOMATIC_CALLER_ID,
  buildTargetsUrl,
  callerIdLabel,
  createLatestOnly,
  parseTargetQuery,
  resolveCallerChoice,
  targetWarning,
  toDialTargets,
  type TargetLeadRow,
} from '@/lib/telephony/dialerTargets';

/** The picker's pure logic (floating dialer): query shaping, target rows, warnings, caller-ID choice. */

const row = (over: Partial<TargetLeadRow> = {}): TargetLeadRow => ({
  id: 'l1',
  firstName: 'Ann',
  lastName: 'Lee',
  company: 'Acme',
  phone: '+66812345678',
  doNotCall: false,
  doNotCallReason: null,
  contactId: null,
  contact: null,
  account: null,
  ...over,
});

describe('parseTargetQuery', () => {
  it('rejects empty, one-character and oversized input', () => {
    expect(parseTargetQuery(null)).toBeNull();
    expect(parseTargetQuery(undefined)).toBeNull();
    expect(parseTargetQuery('  a ')).toBeNull();
    expect(parseTargetQuery('x'.repeat(81))).toBeNull();
  });

  it('keeps a name as text with no phone needles', () => {
    expect(parseTargetQuery('  Nguyễn Hải ')).toEqual({ text: 'Nguyễn Hải', phoneNeedles: [] });
  });

  it('turns a number into digits, plus the digits without a leading zero', () => {
    expect(parseTargetQuery('0948 200 638')).toEqual({ text: '0948 200 638', phoneNeedles: ['0948200638', '948200638'] });
    expect(parseTargetQuery('+84 948')).toEqual({ text: '+84 948', phoneNeedles: ['84948'] });
  });

  it('does not treat two digits, or a name with digits, as a phone', () => {
    expect(parseTargetQuery('12')?.phoneNeedles).toEqual([]);
    expect(parseTargetQuery('acme 2024')?.phoneNeedles).toEqual([]);
  });

  it('survives SQL characters and emoji as plain text', () => {
    expect(parseTargetQuery("o'brien; drop table")?.phoneNeedles).toEqual([]);
    expect(parseTargetQuery('Anh 📞')?.text).toBe('Anh 📞');
  });
});

describe('buildTargetsUrl', () => {
  it('encodes the query and refuses a short one', () => {
    expect(buildTargetsUrl('a&b c')).toBe('/api/telephony/targets?q=a%26b%20c');
    expect(buildTargetsUrl('a')).toBeNull();
  });
});

describe('toDialTargets', () => {
  it('maps a lead to its own dialable number', () => {
    const [t] = toDialTargets([row()], new Set());
    expect(t).toMatchObject({ key: 'l1', leadId: 'l1', contactId: null, name: 'Ann Lee', phone: '+66812345678', kind: 'lead', suppressed: false });
  });

  it('reads a local number with the record country, then as Vietnamese', () => {
    expect(toDialTargets([row({ phone: '0948200638' })], new Set())[0].phone).toBe('+84948200638');
  });

  it('adds the linked contact as a second target when its number differs', () => {
    const targets = toDialTargets(
      [row({ contactId: 'c1', contact: { id: 'c1', fullName: 'Cee Kay', phone: '+65 6123 4567', country: 'Singapore', doNotCall: true } })],
      new Set()
    );
    expect(targets.map((t) => t.key)).toEqual(['l1', 'l1:c1']);
    expect(targets[1]).toMatchObject({ contactId: 'c1', name: 'Cee Kay', phone: '+6561234567', doNotCall: true, kind: 'contact' });
  });

  it('lists a contact whose number equals the lead’s once', () => {
    const targets = toDialTargets([row({ contactId: 'c1', contact: { id: 'c1', fullName: 'Ann', phone: '+66812345678', country: null, doNotCall: false } })], new Set());
    expect(targets).toHaveLength(1);
  });

  it('shows a lead with no number as not dialable instead of dropping it', () => {
    const [t] = toDialTargets([row({ phone: null })], new Set());
    expect(t.phone).toBeNull();
    expect(targetWarning(t)?.block).toBe(true);
  });

  it('marks a suppressed number', () => {
    const [t] = toDialTargets([row()], new Set(['+66812345678']));
    expect(t.suppressed).toBe(true);
    expect(targetWarning(t)).toMatchObject({ block: true });
  });

  it('returns nothing for no rows', () => {
    expect(toDialTargets([], new Set())).toEqual([]);
  });
});

describe('targetWarning', () => {
  const ok = { phone: '+66812345678', doNotCall: false, doNotCallReason: null, suppressed: false };
  it('is null for a callable target', () => expect(targetWarning(ok)).toBeNull());
  it('blocks do-not-call and shows the reason', () => {
    expect(targetWarning({ ...ok, doNotCall: true, doNotCallReason: ' asked ' })?.message).toContain('(asked)');
  });
});

describe('caller ID choice', () => {
  const options = [
    { id: 'n1', e164: '+14155550101', label: 'Sales', country: 'US', isDefault: true, isOverallDefault: false },
    { id: 'n2', e164: '+6561230000', label: null, country: 'SG', isDefault: false, isOverallDefault: false },
  ];
  it('labels with the name or the country', () => {
    expect(callerIdLabel(options[0])).toBe('Sales +14155550101');
    expect(callerIdLabel(options[1])).toBe('SG +6561230000');
  });
  it('keeps a listed choice and falls back to automatic for a vanished one', () => {
    expect(resolveCallerChoice('n2', options)).toBe('n2');
    expect(resolveCallerChoice('gone', options)).toBe(AUTOMATIC_CALLER_ID);
    expect(resolveCallerChoice('', options)).toBe(AUTOMATIC_CALLER_ID);
  });
});

describe('createLatestOnly', () => {
  it('lets only the newest search apply its answer', () => {
    const latest = createLatestOnly();
    const first = latest.begin();
    const second = latest.begin();
    expect(latest.isCurrent(first)).toBe(false);
    expect(latest.isCurrent(second)).toBe(true);
  });
});
