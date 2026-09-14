import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { summarizeBulk } from '@/lib/leads/bulkOutcome';

const ok = (): PromiseSettledResult<Response> => ({ status: 'fulfilled', value: new Response(null, { status: 200 }) });
const http = (status: number): PromiseSettledResult<Response> => ({ status: 'fulfilled', value: new Response(null, { status }) });
const thrown = (): PromiseSettledResult<Response> => ({ status: 'rejected', reason: new Error('network') });

describe('summarizeBulk', () => {
  it('reports plain success when every response was ok', () => {
    expect(summarizeBulk('Reassigned', 'lead', [ok(), ok(), ok()])).toEqual({
      ok: 3, failed: 0, tone: 'success', message: 'Reassigned 3 leads',
    });
  });

  it('counts a non-2xx response as a failure, not a success', () => {
    const out = summarizeBulk('Stage updated for', 'lead', [ok(), http(403), http(404)]);
    expect(out).toMatchObject({ ok: 1, failed: 2, tone: 'warning' });
    expect(out.message).toBe('Stage updated for 1 lead; 2 failed');
  });

  it('counts a thrown fetch as a failure', () => {
    expect(summarizeBulk('Enrolled', 'lead', [thrown(), ok()])).toMatchObject({ ok: 1, failed: 1, tone: 'warning' });
  });

  it('is an error, not a warning, when nothing succeeded', () => {
    expect(summarizeBulk('Enrolled', 'lead', [http(500), thrown()])).toEqual({
      ok: 0, failed: 2, tone: 'error', message: 'Enrolled failed for 2 leads',
    });
  });

  it('singularises', () => {
    expect(summarizeBulk('Reassigned', 'lead', [ok()]).message).toBe('Reassigned 1 lead');
  });
});

describe('the Leads page bulk actions read their responses', () => {
  // Structural: the page must not toast a count it did not verify.
  const src = readFileSync(path.join(process.cwd(), 'app/leads/page.tsx'), 'utf8');
  it('uses allSettled + summarizeBulk, never Promise.all + an unconditional success toast', () => {
    const bulk = src.slice(src.indexOf('const applyBulkAction'), src.indexOf('const handleSort'));
    expect(bulk).toContain('summarizeBulk(');
    expect(bulk).toContain('Promise.allSettled(');
    expect(bulk).not.toMatch(/showToast\(`(Stage updated|Reassigned|Enrolled)[^`]*`, 'success'\)/);
  });
});
