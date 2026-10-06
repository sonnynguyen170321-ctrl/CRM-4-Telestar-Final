import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { canAccessLead, requireAuth, type SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { effectiveQualification, type Qualification } from '@/lib/leads/effectiveQualification';
import { CLEARED_REASON, isReasonFor, reasonLabel } from '@/lib/leads/qualificationReasons';
import { prisma } from '@/lib/prisma';
import { parseBody } from '@/lib/validation/core';

/**
 * A person's verdict on a lead's ICP fit (owner request, 2026-10-06; lib/leads/effectiveQualification.ts).
 *
 * POST records it, DELETE clears it so the score applies again. Whoever may work the lead may
 * decide — its SDR, and the managers above (`canAccessLead`). Each change is one atomic batch:
 * an append-only review row that keeps what the score said at the time, the mirror on the lead
 * that every list and count reads, and a line on the lead's timeline. Repeating the current
 * verdict and reason writes nothing.
 */

const VERDICT_LABEL: Record<Qualification, string> = {
  qualified: 'Qualified',
  needs_review: 'Needs review',
  unqualified: 'Not a fit',
};

const Body = z.object({
  verdict: z.enum(['qualified', 'needs_review', 'unqualified']),
  reasonCode: z.string().min(1).max(64),
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(500).optional()),
});

const LEAD_SELECT = {
  id: true,
  assignedToId: true,
  campaignId: true,
  icpQualification: true,
  icpFitScore: true,
  latestIcpAssessmentId: true,
  qualificationOverride: true,
  latestQualificationReviewId: true,
} as const;

type LoadedLead = {
  id: string;
  assignedToId: string;
  campaignId: string;
  icpQualification: Qualification | null;
  icpFitScore: number | null;
  latestIcpAssessmentId: string | null;
  qualificationOverride: Qualification | null;
  latestQualificationReviewId: string | null;
};

type Loaded = { ok: true; user: SessionUser & { tenantId: string }; lead: LoadedLead } | { ok: false; response: NextResponse };

async function loadLead(params: Promise<{ id: string }>): Promise<Loaded> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return { ok: false, response: user };
  if (!user.tenantId) return { ok: false, response: NextResponse.json({ error: 'No tenant context' }, { status: 403 }) };
  const { id } = await params;
  const lead = await prisma.lead.findFirst({ where: { id, tenantId: user.tenantId, archivedAt: null }, select: LEAD_SELECT });
  if (!lead) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (!(await canAccessLead(user, lead))) return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { ok: true, user: user as SessionUser & { tenantId: string }, lead };
}

function writeReview(input: {
  user: SessionUser & { tenantId: string };
  lead: LoadedLead;
  verdict: Qualification | null;
  reasonCode: string;
  note: string | null;
}) {
  const { user, lead, verdict, reasonCode, note } = input;
  const now = new Date();
  const reviewId = randomUUID();
  const before = effectiveQualification(lead).value;
  const description =
    verdict === null
      ? `Cleared the qualification verdict — the ICP score applies again (${lead.icpQualification ? VERDICT_LABEL[lead.icpQualification] : 'not scored'})`
      : `Marked ${VERDICT_LABEL[verdict]} after review — ${reasonLabel(reasonCode)}`;

  return prisma.$transaction([
    prisma.leadQualificationReview.create({
      data: {
        id: reviewId,
        tenantId: user.tenantId,
        leadId: lead.id,
        verdict,
        reasonCode,
        note,
        reviewedById: user.id,
        computedQualification: lead.icpQualification,
        computedFitScore: lead.icpFitScore,
        assessmentId: lead.latestIcpAssessmentId,
      },
    }),
    prisma.lead.update({
      where: { id: lead.id, tenantId: user.tenantId },
      data: {
        qualificationOverride: verdict,
        qualificationOverrideAt: verdict ? now : null,
        qualificationOverrideById: verdict ? user.id : null,
        latestQualificationReviewId: reviewId,
      },
      select: { qualificationOverride: true, qualificationOverrideAt: true, icpQualification: true },
    }),
    prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        leadId: lead.id,
        type: 'qualification_reviewed',
        description,
        // The note stays on the review row only: the timeline is read more widely than the review.
        metadata: { from: before, to: verdict, reasonCode, computed: lead.icpQualification },
      },
    }),
  ]);
}

function respond(updated: { qualificationOverride: Qualification | null; qualificationOverrideAt: Date | null; icpQualification: Qualification | null }) {
  return NextResponse.json({
    qualificationOverride: updated.qualificationOverride,
    qualificationOverrideAt: updated.qualificationOverrideAt,
    effective: effectiveQualification(updated),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadLead(params);
  if (!loaded.ok) return loaded.response;
  const { user, lead } = loaded;

  const parsed = await parseBody(req, Body, 'Invalid qualification review');
  if (parsed.error) return parsed.error;
  const { verdict, reasonCode, note } = parsed.data;

  if (!isReasonFor(reasonCode, verdict)) {
    return NextResponse.json({ error: 'That reason does not fit this verdict', code: 'invalid_reason' }, { status: 400 });
  }
  if (reasonCode === 'other' && !note) {
    return NextResponse.json({ error: 'Say why in the note', code: 'note_required' }, { status: 400 });
  }

  try {
    if (lead.qualificationOverride === verdict && !note && lead.latestQualificationReviewId) {
      const latest = await prisma.leadQualificationReview.findFirst({
        where: { id: lead.latestQualificationReviewId, tenantId: user.tenantId },
        select: { reasonCode: true },
      });
      if (latest?.reasonCode === reasonCode) {
        return respond({ qualificationOverride: lead.qualificationOverride, qualificationOverrideAt: null, icpQualification: lead.icpQualification });
      }
    }
    const [, updated] = await writeReview({ user, lead, verdict, reasonCode, note: note ?? null });
    return respond(updated);
  } catch (err) {
    return handleApiError('api/leads/[id]/qualification POST', err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadLead(params);
  if (!loaded.ok) return loaded.response;
  const { user, lead } = loaded;

  try {
    if (!lead.qualificationOverride) {
      return respond({ qualificationOverride: null, qualificationOverrideAt: null, icpQualification: lead.icpQualification });
    }
    const [, updated] = await writeReview({ user, lead, verdict: null, reasonCode: CLEARED_REASON, note: null });
    return respond(updated);
  } catch (err) {
    return handleApiError('api/leads/[id]/qualification DELETE', err);
  }
}
