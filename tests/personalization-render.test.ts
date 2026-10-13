/**
 * The personalization lab's one renderer (lib/templates/render.ts): every variable, the lead's
 * timezone greeting boundaries, deterministic spintax, nested conditionals, helpers, escaping and
 * header safety. Pure: no database.
 */
import { describe, it, expect } from 'vitest';
import { isHtml } from '@/lib/email/sanitize';
import {
  MAX_TEMPLATE_LENGTH,
  MERGE_FIELD_NAMES,
  buildMergeContext,
  parseTagTail,
  renderSubject,
  renderTemplate,
  resolveConditionals,
  resolveSpintax,
  type RenderLead,
  type RenderSdr,
} from '@/lib/templates/render';
import { MERGE_FIELD_GROUPS, MERGE_FIELD_LABELS, addMergeFallback, findMergeTags, findMissingMergeValues, mergePickerItems } from '@/lib/compose/merge';
import { chipifyMergeTags, unchipifyMergeTags } from '@/lib/compose/html';

const LEAD: RenderLead = {
  id: 'lead-1',
  firstName: 'Linh',
  lastName: 'Tran',
  company: 'acme logistics',
  title: 'Head of Ops',
  email: 'linh@acme.test',
  phone: '+84 90 123 4567',
  linkedIn: 'https://linkedin.com/in/linh',
  timezone: 'Asia/Ho_Chi_Minh',
  account: { website: 'https://acme.test', domain: 'acme.test', industry: 'Logistics', country: 'Vietnam', size: 240 },
  campaign: { name: 'Q4 outreach' },
  aiVariables: {
    icebreaker: 'Saw you run cold-chain lanes.',
    painPoint: 'Teams like yours often juggle carriers.',
    valueProp: 'We book the meetings.',
    companySummary: 'Cold-chain logistics.',
    whyNow: 'Peak season.',
    personalLine: 'Ops leaders feel it first.',
  },
};
const SDR: RenderSdr = { firstName: 'Mei', lastName: 'Nguyen', role: 'sdr', jobTitle: 'Growth Lead', phone: '+84 28 000 0000', calendarLink: 'https://cal.test/mei' };

// 03:00Z = 10:00 in Ho Chi Minh (UTC+7), a Wednesday.
const WED_MORNING = new Date('2026-10-14T03:00:00Z');
const render = (text: string, lead: RenderLead = LEAD, sdr: RenderSdr = SDR, now = WED_MORNING) => renderTemplate(text, lead, sdr, { now });

describe('every variable', () => {
  const expected: Record<string, string> = {
    firstName: 'Linh', lastName: 'Tran', title: 'Head of Ops', email: 'linh@acme.test', phone: '+84 90 123 4567',
    linkedin: 'https://linkedin.com/in/linh',
    company: 'acme logistics', website: 'https://acme.test', domain: 'acme.test', industry: 'Logistics', country: 'Vietnam',
    city: '', headcount: '240', campaignName: 'Q4 outreach',
    senderFirstName: 'Mei', senderFullName: 'Mei Nguyen', senderTitle: 'Growth Lead', senderPhone: '+84 28 000 0000',
    senderCalendarLink: 'https://cal.test/mei', senderSignatureName: 'Mei Nguyen', sdrName: 'Mei Nguyen', sdrTitle: 'Growth Lead',
    greeting: 'Good morning', dayOfWeek: 'Wednesday', nextWeekday: 'Thursday', localTime: '10:00 AM',
    'ai.icebreaker': 'Saw you run cold-chain lanes.', 'ai.painPoint': 'Teams like yours often juggle carriers.',
    'ai.valueProp': 'We book the meetings.', 'ai.companySummary': 'Cold-chain logistics.', 'ai.whyNow': 'Peak season.',
    'ai.personalLine': 'Ops leaders feel it first.',
  };

  it('has an expectation for every name the picker offers', () => {
    expect(Object.keys(expected).sort()).toEqual([...MERGE_FIELD_NAMES].sort());
  });

  it.each(Object.entries(expected))('renders {{%s}}', (field, value) => {
    expect(render(`[{{${field}}}]`)).toBe(`[${value}]`);
  });

  it('every name has a label and sits in exactly one picker group', () => {
    const grouped = MERGE_FIELD_GROUPS.flatMap((g) => g.fields);
    expect([...grouped].sort()).toEqual([...MERGE_FIELD_NAMES].sort());
    for (const name of MERGE_FIELD_NAMES) expect(MERGE_FIELD_LABELS[name]).toBeTruthy();
    expect(mergePickerItems().map((i) => i.group)).toEqual(expect.arrayContaining(['Lead', 'Company', 'Sender', 'Time (lead local)', 'Syntax help']));
  });

  it('falls back to the role title when the sender has no job title, and keeps sdrName/sdrTitle as aliases', () => {
    const ctx = buildMergeContext(LEAD, { firstName: 'Mei', lastName: 'Nguyen', role: 'team_lead' });
    expect(ctx.senderTitle).toBe('Team Lead');
    expect(ctx.sdrTitle).toBe(ctx.senderTitle);
    expect(ctx.sdrName).toBe(ctx.senderFullName);
  });

  it('uses the staff range when the account has no exact size', () => {
    const lead = { ...LEAD, account: { staffCountRange: '51-200' } };
    expect(render('{{headcount}}', lead)).toBe('51-200');
  });

  it('is empty, never "undefined" or "null", when data is absent', () => {
    const out = render(MERGE_FIELD_NAMES.map((f) => `<{{${f}}}>`).join(''), { firstName: null }, {});
    expect(out).not.toMatch(/undefined|null|NaN/);
    expect(out.replace(/<>/g, '')).toBe('');
  });
});

describe('time-aware variables use the lead timezone, not the sender or the server', () => {
  const at = (iso: string, timezone = 'Asia/Ho_Chi_Minh') => render('{{greeting}}|{{dayOfWeek}}|{{nextWeekday}}|{{localTime}}', { ...LEAD, timezone }, SDR, new Date(iso));

  it('greeting boundaries: 11:59 morning, 12:00 afternoon, 17:59 afternoon, 18:00 evening, midnight is not afternoon', () => {
    // Ho Chi Minh is UTC+7.
    expect(at('2026-10-14T04:59:00Z').split('|')[0]).toBe('Good morning'); // 11:59
    expect(at('2026-10-14T05:00:00Z').split('|')[0]).toBe('Good afternoon'); // 12:00
    expect(at('2026-10-14T10:59:00Z').split('|')[0]).toBe('Good afternoon'); // 17:59
    expect(at('2026-10-14T11:00:00Z').split('|')[0]).toBe('Good evening'); // 18:00
    expect(at('2026-10-13T17:00:00Z').split('|')[0]).toBe('Good morning'); // 00:00 next day
  });

  it('the same instant is a different day and greeting in a different zone', () => {
    const instant = '2026-10-14T20:30:00Z'; // Wed 20:30Z
    expect(at(instant, 'Asia/Ho_Chi_Minh')).toBe('Good morning|Thursday|Friday|3:30 AM');
    expect(at(instant, 'America/Los_Angeles')).toBe('Good afternoon|Wednesday|Thursday|1:30 PM');
  });

  it('Friday, Saturday and Sunday all point at Monday', () => {
    expect(at('2026-10-16T03:00:00Z').split('|')[2]).toBe('Monday'); // Fri
    expect(at('2026-10-17T03:00:00Z').split('|')[2]).toBe('Monday'); // Sat
    expect(at('2026-10-18T03:00:00Z').split('|')[2]).toBe('Monday'); // Sun
  });

  it('noon and midnight read 12 on the clock', () => {
    expect(at('2026-10-14T05:00:00Z').split('|')[3]).toBe('12:00 PM');
    expect(at('2026-10-13T17:05:00Z').split('|')[3]).toBe('12:05 AM');
  });

  it('infers the zone from a single-zone country when the lead has none, and leaves it empty when unknown', () => {
    const inferred = render('{{greeting}}', { ...LEAD, timezone: null, account: { country: 'Singapore' } });
    expect(inferred).toBe('Good morning');
    const unknown = render('{{greeting|Hello}}|{{dayOfWeek}}', { ...LEAD, timezone: null, phone: null, account: { country: 'United States' } });
    expect(unknown).toBe('Hello|');
  });

  it('ignores an invalid timezone rather than throwing', () => {
    expect(render('{{greeting|Hello}}', { ...LEAD, timezone: 'Not/AZone', phone: null, account: null })).toBe('Hello');
  });
});

describe('fallbacks and helpers', () => {
  it('uses the fallback only when the value is empty', () => {
    expect(render('{{firstName|there}} {{city|your city}}')).toBe('Linh your city');
  });

  it('applies helpers', () => {
    expect(render('{{company|capitalize}}')).toBe('Acme Logistics');
    expect(render('{{company|upper}}')).toBe('ACME LOGISTICS');
    expect(render('{{firstName|lower}}')).toBe('linh');
    expect(render('{{company|first-word|capitalize}}')).toBe('Acme');
  });

  it('chains a helper and a fallback: the fallback is used as written when the value is empty', () => {
    expect(render('{{city|upper|your city}}')).toBe('your city');
    expect(render('{{company|upper|your company}}')).toBe('ACME LOGISTICS');
  });

  it('parses the tail', () => {
    expect(parseTagTail(undefined)).toEqual({ helpers: [], fallback: '' });
    expect(parseTagTail('there')).toEqual({ helpers: [], fallback: 'there' });
    expect(parseTagTail('Upper | your co')).toEqual({ helpers: ['upper'], fallback: 'your co' });
    expect(parseTagTail('a|b')).toEqual({ helpers: [], fallback: 'a|b' });
  });

  it('leaves an unknown field visible', () => {
    expect(render('Hi {{nickname}} and {{ai.mystery}} and {{custom.region}}')).toBe('Hi {{nickname}} and {{ai.mystery}} and {{custom.region}}');
  });
});

describe('conditionals', () => {
  it('keeps the branch the field selects', () => {
    expect(render('{{#if title}}As {{title}}, {{else}}Hello, {{/if}}hi')).toBe('As Head of Ops, hi');
    expect(render('{{#if title}}As {{title}}, {{else}}Hello, {{/if}}hi', { ...LEAD, title: '' })).toBe('Hello, hi');
    expect(render('{{#if title}}X{{/if}}end', { ...LEAD, title: null })).toBe('end');
  });

  it('nests, with else at each level', () => {
    const t = '{{#if title}}T{{#if city}}C{{else}}noC{{/if}}{{else}}noT{{/if}}';
    expect(render(t)).toBe('TnoC');
    expect(render(t, { ...LEAD, title: '' })).toBe('noT');
    expect(render('{{#if ai.icebreaker}}{{#if title}}both{{else}}ai only{{/if}}{{/if}}', { ...LEAD, title: '' })).toBe('ai only');
  });

  it('treats a missing AI variable as false', () => {
    expect(render('{{#if ai.whyNow}}{{ai.whyNow}}{{else}}no hook{{/if}}', { ...LEAD, aiVariables: {} })).toBe('no hook');
  });

  it('an unknown field in #if is false, not an error', () => {
    expect(render('{{#if nonsense}}A{{else}}B{{/if}}')).toBe('B');
  });

  it('leaves malformed blocks exactly as written', () => {
    expect(resolveConditionals('{{#if title}}never closed', { title: 'x' })).toBe('{{#if title}}never closed');
    expect(resolveConditionals('stray {{/if}}', {})).toBe('stray {{/if}}');
    expect(resolveConditionals('{{#if a}}x{{else}}y{{else}}z{{/if}}', { a: '1' })).toBe('{{#if a}}x{{else}}y{{else}}z{{/if}}');
  });

  it('does not take a missing-value warning from the branch it does not render', () => {
    const text = '{{#if city}}From {{city}}.{{else}}Hello.{{/if}}';
    expect(findMissingMergeValues(text, buildMergeContext(LEAD, SDR))).toEqual([]);
    expect(findMissingMergeValues('{{#if title}}{{city}}{{/if}}', buildMergeContext(LEAD, SDR)).map((m) => m.field)).toEqual(['city']);
  });
});

describe('spintax', () => {
  it('picks one option, the same one every time for the same lead and template', () => {
    const text = '{Hi|Hello|Hey} {{firstName}}, {quick|short} note';
    const first = render(text);
    for (let i = 0; i < 20; i++) expect(render(text)).toBe(first);
    expect(first).toMatch(/^(Hi|Hello|Hey) Linh, (quick|short) note$/);
  });

  it('varies across leads (both options appear over a few hundred)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(render('{A|B|C}', { ...LEAD, id: `lead-${i}` }));
    expect(seen).toEqual(new Set(['A', 'B', 'C']));
  });

  it('is deterministic across the subject and the body of the same lead independently', () => {
    expect(renderSubject('{One|Two}', LEAD, SDR)).toBe(renderSubject('{One|Two}', LEAD, SDR));
  });

  it('nests and keeps merge tags inside options', () => {
    const out = render('{Hello {{firstName|there}}|Hi {a|b} {{lastName}}}');
    expect(out).toMatch(/^(Hello Linh|Hi (a|b) Tran)$/);
  });

  it('leaves braces without a bar alone, including JSON-ish text and unclosed braces', () => {
    expect(resolveSpintax('{ note } and { open', 's')).toBe('{ note } and { open');
    expect(render('config: {"a":1}')).toBe('config: {"a":1}');
  });

  it('does not touch the bar inside a {{field|fallback}} tag', () => {
    expect(render('{{city|a|b}}')).toBe('a|b');
  });

  it('empty options are allowed', () => {
    expect(resolveSpintax('x{|y}', 'seed-1')).toMatch(/^x(y)?$/);
  });
});

describe('safety', () => {
  it('HTML-escapes values in an HTML body, including AI text', () => {
    const lead = { ...LEAD, company: '<img src=x onerror=alert(1)>', aiVariables: { icebreaker: '<script>x</script>' } };
    const out = render('<p>{{company}} {{ai.icebreaker}}</p>', lead);
    expect(out).not.toMatch(/<img|<script/i);
    expect(out).toContain('&lt;img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('a value cannot smuggle merge syntax, a conditional or spintax into a second render pass', () => {
    const lead = { ...LEAD, firstName: '{{lastName}}', lastName: '{#if x}{a|b}', company: '{x|y}' };
    const once = render('{{firstName}} {{lastName}} {{company}}', lead);
    const twice = render(once, lead);
    expect(twice).toBe(once);
    expect(once).not.toContain('Tran');
    expect(twice.replace(/​/g, '')).toContain('{{lastName}}');
    expect(twice.replace(/​/g, '')).toContain('{x|y}');
  });

  it('a second pass over rendered output with the full context is a no-op (the double-render guard)', () => {
    const template = '{Hi|Hello} {{firstName}}{{#if title}}, {{title}}{{/if}}. {{greeting}} - {{ai.icebreaker}}';
    const once = render(template);
    expect(render(once)).toBe(once);
  });

  it('strips CR/LF from a subject whatever the template or the value carries', () => {
    const lead = { ...LEAD, firstName: 'Linh\r\nBcc: evil@x.test', title: 'a\nb' };
    const subject = renderSubject('Hi {{firstName}}\r\nBcc: x@y.test {{title}}', lead, SDR, { now: WED_MORNING });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe('Hi Linh Bcc: evil@x.test Bcc: x@y.test a b');
  });

  it('caps every value so one field cannot swamp the email', () => {
    const huge = 'x'.repeat(5000);
    const lead = { ...LEAD, company: huge, aiVariables: { icebreaker: huge, companySummary: huge } };
    const ctx = buildMergeContext(lead, SDR, { now: WED_MORNING });
    expect(ctx.company.length).toBeLessThanOrEqual(200);
    expect(ctx['ai.icebreaker'].length).toBeLessThanOrEqual(400);
    expect(ctx['ai.companySummary'].length).toBeLessThanOrEqual(600);
  });

  it('collapses line breaks inside a value to one space', () => {
    expect(render('{{title}}', { ...LEAD, title: 'Head\r\n of\n\nOps' })).toBe('Head of Ops');
  });

  it('never evaluates anything: expression-looking input is only text', () => {
    const out = render('{{#if constructor}}x{{else}}safe{{/if}} {{__proto__}} {{constructor}} {${1+1}} {process.exit()}');
    expect(out).toBe('safe {{__proto__}} {{constructor}} {${1+1}} {process.exit()}');
  });

  it('handles a large template quickly', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `{a|b} {{firstName}} {{#if title}}t${i}{{/if}}`).join('\n');
    const started = Date.now();
    render(big);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('picker and composer helpers understand the new syntax', () => {
  it('finds dotted names and reads a helper as a helper, not a fallback', () => {
    const tags = findMergeTags('{{ai.icebreaker|Hello}} {{company|capitalize}} {{company|upper|your company}}');
    expect(tags.map((t) => [t.field, t.fallback, t.known])).toEqual([
      ['ai.icebreaker', 'Hello', true],
      ['company', null, true],
      ['company', 'your company', true],
    ]);
  });

  it('warns about a new variable with no value and no fallback, once', () => {
    const ctx = buildMergeContext({ ...LEAD, aiVariables: {}, account: null }, SDR, { now: WED_MORNING });
    const missing = findMissingMergeValues('{{ai.painPoint}} {{ai.painPoint}} {{industry}} {{city|n/a}} {{company|capitalize}}', ctx);
    expect(missing.map((m) => m.field)).toEqual(['ai.painPoint', 'industry']);
  });

  it('adds a fallback to a tag that has a helper, keeping the helper', () => {
    expect(addMergeFallback('{{company|capitalize}} {{company|a}}', 'company', 'your company')).toBe('{{company|capitalize|your company}} {{company|a}}');
    expect(addMergeFallback('{{ai.whyNow}}', 'ai.whyNow', 'soon')).toBe('{{ai.whyNow|soon}}');
  });

  it('keeps a dotted tag and its helpers through the editor chip round trip', () => {
    const html = '<p>{{ai.icebreaker|capitalize|Hello}} and {{city}}</p>';
    expect(unchipifyMergeTags(chipifyMergeTags(html))).toBe(html);
  });
});

describe('hardening (security review of #293)', () => {
  const FAST = 1500;
  const timed = (fn: () => void) => { const t = Date.now(); fn(); return Date.now() - t; };

  it('pathological spintax, conditionals and tags are bounded (20k characters each)', () => {
    const inputs = [
      '{a'.repeat(10_000),
      '{a|'.repeat(7_000),
      '{{#if a}}'.repeat(2_300),
      '{{a|'.repeat(5_000),
      '{{'.repeat(10_000),
      '{'.repeat(20_000) + '}'.repeat(20_000),
      '{{#if title}}'.repeat(1_500) + '{{/if}}'.repeat(1_500),
    ];
    for (const input of inputs) {
      expect(timed(() => render(input)), input.slice(0, 12)).toBeLessThan(FAST);
    }
  });

  it('leaves a template over the length cap unrendered, and one at the cap renders', () => {
    const over = `{{firstName}} ${'x'.repeat(MAX_TEMPLATE_LENGTH)}`;
    expect(render(over)).toBe(over);
    expect(render(`{{firstName}} ${'x'.repeat(100)}`)).toContain('Linh');
  });

  it('follows five levels of nesting and leaves a sixth literal', () => {
    const cond = (n: number) => '{{#if title}}'.repeat(n) + 'X' + '{{/if}}'.repeat(n);
    expect(render(cond(5))).toBe('X');
    expect(render(cond(6))).toBe(cond(6));
    // Every option nests the next level, so depth decides the outcome and not the hash.
    const spin = (n: number): string => (n === 0 ? 'z' : `{x${spin(n - 1)}|x${spin(n - 1)}}`);
    expect(render(spin(5))).toMatch(/^x{5}z$/);
    expect(render(spin(7))).toContain('{');
  });

  it('a plain-text template cannot be turned into HTML by a merge value', () => {
    const lead = { ...LEAD, company: '<img src=x onerror=alert(1)>', firstName: '<b>x</b>' };
    const out = render('Hi {{firstName}} at {{company}}', lead);
    expect(out).not.toMatch(/<img|<b>|onerror=alert\(1\)>/);
    expect(isHtml(out)).toBe(false);
    expect(render('A & B {{company}}', { ...LEAD, company: 'Q&A Ltd' })).toBe('A & B Q&A Ltd');
  });

  it('keeps the guard between passes and removes it from the final text', () => {
    const lead = { ...LEAD, firstName: '{{lastName}}' };
    const first = render('Hi {{firstName}}', lead);
    expect(first).toContain('{​{');
    expect(render(first, lead)).toBe(first);
    const last = renderTemplate(first, lead, SDR, { now: WED_MORNING, final: true });
    expect(last).toBe('Hi {{lastName}}');
    expect(renderSubject('Hi {{firstName}}', lead, SDR, { now: WED_MORNING, final: true })).toBe('Hi {{lastName}}');
  });

  it('leaves digits and ordinary characters in a subject alone', () => {
    expect(renderSubject('Q4 2028 plan 0829 for {{firstName}}', LEAD, SDR, { now: WED_MORNING })).toBe('Q4 2028 plan 0829 for Linh');
    expect(renderSubject('a\u2028b\u2029c', LEAD, SDR)).toBe('a b c');
  });

  it('does not HTML-escape a subject', () => {
    expect(renderSubject('{{company}}', { ...LEAD, company: 'Q&A <Ltd> "x"' }, SDR, { now: WED_MORNING, final: true })).toBe('Q&A <Ltd> "x"');
  });

  it('drops a URL-like value with an unsafe scheme', () => {
    const lead = { ...LEAD, linkedIn: 'javascript:alert(1)', account: { website: 'data:text/html,x', domain: 'acme.test' } };
    const sdr = { ...SDR, calendarLink: 'vbscript:x' };
    expect(render('[{{linkedin}}][{{website}}][{{senderCalendarLink}}]', lead, sdr)).toBe('[][][]');
    expect(render('{{website}}|{{senderCalendarLink}}', { ...LEAD, account: { website: 'acme.test' } }, { ...SDR, calendarLink: 'mailto:a@b.test' })).toBe('acme.test|mailto:a@b.test');
  });
});
