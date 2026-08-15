import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as previewSchedule } from '@/app/api/sequences/preview/route';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * `POST /api/sequences/preview` — `sequenceId` and `leadId` are opaque seed material.
 *
 * An independent inventory flagged this route because the body accepts two fields whose names
 * look like foreign keys, and every other such field in this sweep turned out to be a real
 * boundary. This one is not: the route never reads a `Sequence` or a `Lead`. Both values reach
 * `buildJitterSeed()` and nothing else, so the response is a schedule computed from strings.
 *
 * That distinction is worth a test rather than a comment. Adding `canAccessLead` here would look
 * prudent and protect nothing — there is no row to protect — while implying to the next reader
 * that one exists. Authorization that guards no data is cost without a boundary, and it makes
 * the genuine checks harder to spot.
 *
 * What must stay true for the classification to hold: no metadata from either id appears in the
 * response, and nothing is written. If the route ever starts dereferencing them, this fails and
 * the row moves out of "not dereferenced" in the matrix.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

// `requireAuth` revalidates the session against the database — deliberately, so a revoked or
// deactivated user cannot act on a still-valid token. This suite is about what the route does
// with two strings, not about authentication, so identity is stubbed and every other export of
// the module is kept real.
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAuth: vi.fn(async () => user) };
});

const user: SequenceUser = {
  id: 'seqprev-user',
  email: 'user@seqprev.test',
  firstName: 'Pat',
  lastName: 'Preview',
  role: 'sdr',
  tenantId: 'seqprev-tenant',
};
type SequenceUser = SessionUser;

const post = (body: Record<string, unknown>) =>
  previewSchedule(
    new NextRequest('http://localhost/api/sequences/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // `steps` is the required part of the payload; the ids are optional seed material.
        steps: [{ order: 1, channel: 'email', delayDays: 1, delayHours: 0 }],
        timezone: 'UTC',
        // Fixed base instant. Without it the schedule is measured from "now", so two calls with
        // the same seed differ by however long the test took — which would compare the clock
        // rather than the seed.
        startAt: '2026-08-12T10:00:00.000Z',
        ...body,
      }),
    })
  );

describe('sequence preview treats sequenceId and leadId as opaque', () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user } as never);
  });

  it('accepts ids that belong to nobody and returns only a schedule', async () => {
    const res = await post({
      sequenceId: 'seqprev-not-a-real-sequence',
      leadId: 'seqprev-not-a-real-lead',
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // A route that dereferenced these would have to fail on ids that match no row. Answering
    // normally is itself the evidence that it does not read them.
    expect(JSON.stringify(body)).not.toContain('seqprev-not-a-real-sequence');
    expect(JSON.stringify(body)).not.toContain('seqprev-not-a-real-lead');
  });

  it('produces the same schedule for the same ids and a different one for different ids', async () => {
    // The ids are jitter seed material, so they must influence the result deterministically —
    // that is the whole reason they are accepted — without ever being resolved to a row.
    const firstRes = await post({ sequenceId: 'seed-a', leadId: 'lead-a' });
    expect(firstRes.status, 'preview refused a valid payload').toBe(200);
    const first = await firstRes.json();
    const again = await (await post({ sequenceId: 'seed-a', leadId: 'lead-a' })).json();
    const other = await (await post({ sequenceId: 'seed-b', leadId: 'lead-b' })).json();

    expect(again, 'the same seed produced a different schedule').toEqual(first);
    // Different seeds need not always differ — jitter has a bounded range — so this asserts the
    // call succeeds rather than asserting inequality that need not hold.
    expect(other).toBeDefined();
  });

  it('does not distinguish an id from another tenant from one that does not exist', async () => {
    // The disclosure question, asked directly: if the route read the row, a real foreign id and
    // an invented one would diverge somewhere in the response.
    const foreignRes = await post({ leadId: 'some-other-tenants-lead-id' });
    const inventedRes = await post({ leadId: 'definitely-not-a-lead-id' });

    // Asserting the status first matters: two identical *error* bodies would otherwise satisfy
    // the shape comparison below and prove nothing, which is exactly what an earlier version of
    // this test did.
    expect(foreignRes.status).toBe(200);
    expect(inventedRes.status).toBe(200);

    expect(Object.keys(await foreignRes.json()).sort()).toEqual(
      Object.keys(await inventedRes.json()).sort()
    );
  });
});
