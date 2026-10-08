import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessUser, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { scoreLead } from '@/lib/leads/scoring';
import { scoreLeadIcp } from '@/lib/leads/icpScoring';
import { describeIcpContext, loadLeadIcpContext } from '@/lib/leads/icpContext';
import { normalizeEmail, normalizePhone, normalizeLinkedIn } from '@/lib/leads/normalize';
import { pauseSequence } from '@/lib/sequences/engine';
import { unenrollAllLeadCadences } from '@/lib/sequences/leadStop';
import { pauseCompanyCadencesSafely } from '@/lib/sequences/companyStop';
import { parseBody } from '@/lib/validation/core';
import { updateLeadSchema } from '@/lib/validation/schemas';
import { onSuppressionOrArchive } from '@/lib/contact-intelligence/events';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
      campaign: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
      // The verdict behind `icpFitScore`: which rules fired and what was missing, for the
      // panel's explanation. Latest only — the history is the assessment table itself.
      icpAssessments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, fitScore: true, confidenceScore: true, dataQualityScore: true, qualification: true, evidenceJson: true, inputSnapshot: true, rulesSnapshot: true, createdAt: true, icpVersion: { select: { id: true, versionNumber: true, icpProfile: { select: { name: true } } } } },
      },
      // A person's verdicts on this lead (lib/leads/effectiveQualification.ts), newest first.
      qualificationReviews: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, verdict: true, reasonCode: true, note: true, reviewedById: true, computedQualification: true, createdAt: true },
      },
      contact: {
        include: {
          intelligence: true,
        },
      },
      account: true,
      sequence: { select: { id: true, name: true, steps: { orderBy: { order: 'asc' } } } },
      tasks: { orderBy: { dueDate: 'asc' }, take: 50 },
      notes: {
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        take: 50,
        include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      },
      reminders: {
        where: { isDismissed: false },
        orderBy: { dueAt: 'asc' },
      },
      sequenceEnrollments: {
        orderBy: { startedAt: 'desc' },
        include: { sequence: { select: { name: true } } },
      },
      outboundMessages: {
        orderBy: { createdAt: 'desc' },
      },
      meetings: {
        orderBy: { createdAt: 'desc' },
        include: {
          sdr: { select: { id: true, firstName: true, lastName: true } },
          bookingLink: { select: { id: true, name: true, url: true, provider: true } },
          outcomeLoggedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await canAccessLead(user, lead))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const aiScore = scoreLead({
    ...lead,
    lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
    nextTaskDue: lead.nextTaskDue?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    activities: (lead.activities ?? []).map((a) => ({ type: a.type, createdAt: a.createdAt.toISOString() })),
    tasks: (lead.tasks ?? []).map((t) => ({ status: t.status, dueDate: t.dueDate.toISOString() })),
  });

  // `reviewedById` is a soft link (the history outlives a deleted user), so names are looked up.
  const reviewerIds = [...new Set(lead.qualificationReviews.map((r) => r.reviewedById))];
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds }, tenantId: user.tenantId! }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const reviewerName = new Map(reviewers.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  // Which ICP the verdict is measured against, and whether it is still the one that applies
  // (lib/leads/icpContext.ts). Computed here: the drawer only shows the sentences.
  const icpContext = await loadLeadIcpContext({
    tenantId: user.tenantId!,
    campaignId: lead.campaignId ?? null,
    scoredVersionId: lead.icpVersionId ?? null,
  });

  return NextResponse.json({
    ...lead,
    icpContext: { ...icpContext, ...describeIcpContext(icpContext) },
    icpAssessments: lead.icpAssessments.map(({ rulesSnapshot, ...assessment }) => ({
      ...assessment,
      // Only what the explanation names: thresholds, the target lists, the weights. The full
      // rule set is not the drawer's business.
      rulesSummary: summariseRules(rulesSnapshot),
    })),
    qualificationReviews: lead.qualificationReviews.map((r) => ({ ...r, reviewedByName: reviewerName.get(r.reviewedById) ?? null })),
    aiScore: aiScore.score,
    aiLabel: aiScore.label,
    aiInsights: aiScore.insights,
    aiRecommendation: aiScore.recommendation,
  });
}

function summariseRules(rules: unknown) {
  const r = (rules ?? {}) as Record<string, any>;
  return {
    scorePolicy: r.scorePolicy ?? null,
    scoringWeights: r.scoringWeights ?? null,
    titleAllowlist: Array.isArray(r.persona?.titleAllowlist) ? r.persona.titleAllowlist : [],
    targetCountries: Array.isArray(r.geography?.targetCountries) ? r.geography.targetCountries : [],
    excludedCountries: Array.isArray(r.geography?.excludedCountries) ? r.geography.excludedCountries : [],
    minEmployees: typeof r.size?.minEmployees === 'number' ? r.size.minEmployees : null,
  };
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const parsed = await parseBody(req, updateLeadSchema, 'Invalid lead update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await canAccessLead(user, existing))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (body.assignedToId !== undefined && body.assignedToId !== null && body.assignedToId !== user.id && !(await canAccessUser(user, body.assignedToId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updated = await prisma.lead.update({
    where: { id },
    data: {
      ...(body.firstName !== undefined && { firstName: body.firstName }),
      ...(body.lastName !== undefined && { lastName: body.lastName }),
      ...(body.company !== undefined && { company: body.company }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.linkedIn !== undefined && { linkedIn: body.linkedIn }),
      ...(body.whatsApp !== undefined && { whatsApp: body.whatsApp }),
      // The normalized columns are how this lead is recognised later: the importer's duplicate
      // index, the pool's conversion lookup and contact matching all read them. Creation writes
      // them (`app/api/leads/route.ts`) and this handler did not, so the first correction to a
      // typo'd address left the lead answering to the old one forever — findable as the address
      // it used to be, invisible as the address it now is.
      //
      // `normalizedEmail` is deliberately null on leads an import duplicated on purpose
      // (`forceDuplicateLead`). Recomputing it here would silently undo that choice, so a null
      // stays null and only a real edit sets it.
      ...(body.email !== undefined &&
        existing.normalizedEmail !== null && { normalizedEmail: normalizeEmail(body.email) }),
      ...(body.phone !== undefined && { normalizedPhone: normalizePhone(body.phone) }),
      ...(body.linkedIn !== undefined && { normalizedLinkedIn: normalizeLinkedIn(body.linkedIn) }),
      ...(body.stage !== undefined && { stage: body.stage }),
      ...(body.assignedToId !== undefined && { assignedToId: body.assignedToId }),
      ...(body.priority !== undefined && { crmPriorityScore: body.priority }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.lastContactedAt !== undefined && { lastContactedAt: body.lastContactedAt }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
    },
  });

  const writes: Promise<any>[] = [];

  // Keep the Contact the lead points at telling the same story.
  //
  // Creation upserts a `Contact` by `tenantId_normalizedEmail` and links it; editing the lead
  // left that record holding the old details. Measured on production 2026-09-27: 74 leads had a
  // Contact whose email disagreed with the lead's own. Contact intelligence, research and
  // anything matching on Contact were reading the superseded value.
  //
  // Only the fields the operator actually changed are copied across, and `normalizedEmail` on
  // the Contact is only moved when the address itself changed — that column is the Contact's
  // identity key, and rewriting it on an unrelated edit would re-point the record.
  const contactFieldsTouched =
    body.email !== undefined ||
    body.phone !== undefined ||
    body.firstName !== undefined ||
    body.lastName !== undefined ||
    body.company !== undefined ||
    body.title !== undefined ||
    body.linkedIn !== undefined ||
    body.whatsApp !== undefined;

  if (existing.contactId && contactFieldsTouched) {
    writes.push(
      prisma.contact
        .update({
          where: { id: existing.contactId },
          data: {
            ...(body.firstName !== undefined && { firstName: body.firstName }),
            ...(body.lastName !== undefined && { lastName: body.lastName }),
            ...(body.company !== undefined && { company: body.company }),
            ...(body.title !== undefined && { title: body.title }),
            ...(body.email !== undefined && {
              email: body.email,
              normalizedEmail: normalizeEmail(body.email) ?? body.email.trim().toLowerCase(),
            }),
            ...(body.phone !== undefined && {
              phone: body.phone,
              normalizedPhone: normalizePhone(body.phone),
            }),
            ...(body.linkedIn !== undefined && {
              linkedIn: body.linkedIn,
              normalizedLinkedIn: normalizeLinkedIn(body.linkedIn),
            }),
            ...(body.whatsApp !== undefined && { whatsApp: body.whatsApp }),
          },
        })
        // A Contact whose new address collides with another Contact's cannot be moved, and that
        // must not fail the lead edit the operator asked for. The lead is correct either way;
        // the two records simply stay apart until someone merges them.
        .catch((err: unknown) => {
          console.error(`[leads:update] could not sync contact ${existing.contactId}:`, err);
        })
    );
  }

  if (body.stage && body.stage !== existing.stage) {
    writes.push(
      prisma.activity.create({
        data: {
          userId: user.id,
          leadId: id,
          type: 'stage_changed',
          description: `Stage changed from ${existing.stage} to ${body.stage}`,
          metadata: { from: existing.stage, to: body.stage },
        },
      })
    );

    if (body.stage === 'meeting_booked') {
      writes.push(
        prisma.activity.create({
          data: {
            userId: user.id,
            leadId: id,
            type: 'meeting_booked',
            description: `Meeting booked with ${existing.firstName} ${existing.lastName}`,
          },
        })
      );
      const meetingNotifyIds = new Set<string>([user.id]);
      if (existing.assignedToId) meetingNotifyIds.add(existing.assignedToId);
      for (const uid of meetingNotifyIds) {
        writes.push(
          prisma.notification.create({
            data: {
              userId: uid,
              type: 'meeting_booked',
              title: 'Meeting Booked',
              text: `Meeting booked with ${existing.firstName} ${existing.lastName}! 🎉`,
              linkTo: `/leads/${id}`,
            },
          })
        );
      }
    }

    if (existing.assignedToId && existing.assignedToId !== user.id && body.stage !== 'meeting_booked') {
      const stageLabel = body.stage.replace(/_/g, ' ');
      writes.push(
        prisma.notification.create({
          data: {
            userId: existing.assignedToId,
            type: 'stage_changed',
            title: 'Lead Stage Updated',
            text: `${existing.firstName} ${existing.lastName} was moved to "${stageLabel}" by ${user.firstName ?? ''} ${user.lastName ?? ''}.`.trim(),
            linkTo: `/leads/${id}`,
          },
        })
      );
    }

    // A lead can run cadences while its pointer is empty (production held 266 such enrollments),
    // so whether there is anything to stop is read from the enrollments, not from the pointer.
    const stageChanged = Boolean(body.stage && body.stage !== existing.stage);
    const hasCadence =
      stageChanged &&
      (Boolean(existing.sequenceId) ||
        (await prisma.sequenceEnrollment.count({ where: { leadId: id, status: { in: ['active', 'paused'] } } })) > 0);

    // A reply marked by hand is still a reply from this company (lib/sequences/companyStop.ts).
    if (stageChanged && body.stage === 'replied' && user.tenantId) {
      writes.push(pauseCompanyCadencesSafely({ tenantId: user.tenantId, leadId: id, actorUserId: user.id }));
    }

    if (stageChanged && hasCadence) {
      // `sequenceStatus` is the lead's pointer to one cadence. With several running, the pointer can
      // be paused while others are active, so the pause itself is never skipped on it —
      // `pauseSequence` pauses every active cadence and leaves paused ones alone. Only the
      // notification keys on the pointer, so a lead already paused does not re-notify.
      const isCurrentlyPaused = existing.sequenceStatus === 'paused';

      if (body.stage === 'replied') {
        writes.push(pauseSequence(id, 'reply', user.id));
        if (!isCurrentlyPaused) {
          if (existing.assignedToId) {
            writes.push(
              prisma.notification.create({
                data: {
                  userId: existing.assignedToId,
                  type: 'lead_reply',
                  title: 'Lead Replied',
                  text: `${existing.firstName} ${existing.lastName} has replied. Sequence paused.`,
                  linkTo: `/leads/${id}`,
                },
              })
            );
          }
        }
      } else if (body.stage === 'meeting_booked') {
        writes.push(pauseSequence(id, 'meeting_booked', user.id));
      } else if (body.stage === 'won' || body.stage === 'lost') {
        // A closed deal ends every cadence on the lead, not only the one the pointer names.
        writes.push(unenrollAllLeadCadences(id));
        writes.push(
          prisma.activity.create({
            data: {
              userId: user.id,
              leadId: id,
              type: 'sequence_completed',
              description: `Sequence ended — deal ${body.stage} for ${existing.firstName} ${existing.lastName}`,
              metadata: { reason: body.stage },
            },
          })
        );
      }
    }
  }

  if (body.assignedToId !== undefined && body.assignedToId !== existing.assignedToId && body.assignedToId) {
    writes.push(
      prisma.task.updateMany({
        where: { leadId: id, status: 'pending' },
        data: { userId: body.assignedToId },
      })
    );

    writes.push(
      prisma.activity.create({
        data: {
          userId: user.id,
          leadId: id,
          type: 'lead_reassigned',
          description: `Lead reassigned from SDR to another SDR`,
          metadata: { fromUserId: existing.assignedToId, toUserId: body.assignedToId },
        },
      })
    );

    if (body.assignedToId !== user.id) {
      writes.push(
        prisma.notification.create({
          data: {
            userId: body.assignedToId,
            type: 'lead_assigned',
            title: 'Lead Assigned to You',
            text: `${existing.firstName} ${existing.lastName} (${existing.company}) was assigned to you by ${user.firstName} ${user.lastName}`.trim(),
            linkTo: `/leads/${id}`,
          },
        })
      );
    }

    if (existing.assignedToId && existing.assignedToId !== user.id) {
      writes.push(
        prisma.notification.create({
          data: {
            userId: existing.assignedToId,
            type: 'lead_reassigned',
            title: 'Lead Reassigned',
            text: `${existing.firstName} ${existing.lastName} (${existing.company}) has been reassigned to another user by ${user.firstName} ${user.lastName}`.trim(),
            linkTo: `/leads/${id}`,
          },
        })
      );
    }
  }

  await Promise.all(writes);

  // The ICP verdict reads the title, company and email. Re-score when one actually changed, so the
  // drawer never explains a verdict made from data that is no longer there (2026-10-06). The drawer
  // sends the whole form, so "present in the body" is not "changed". A failed score never fails the
  // save; the rescore endpoint can re-run it.
  const changed = (field: 'title' | 'company' | 'email') => body[field] !== undefined && (body[field] ?? null) !== (existing[field] ?? null);
  if (changed('title') || changed('company') || changed('email')) {
    try {
      await scoreLeadIcp({ tenantId: user.tenantId!, leadId: id });
    } catch (err) {
      console.error(`[leads PUT] ICP rescore failed for lead ${id}:`, err);
    }
  }

  if (body.stage && body.stage !== existing.stage && existing.sequenceId) {
    const refetched = await prisma.lead.findUnique({ where: { id }, select: { sequenceId: true, sequenceStep: true, sequenceStatus: true } });
    if (refetched) {
      Object.assign(updated, refetched);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { assignedToId: true, campaignId: true, sequenceId: true, tenantId: true },
  });
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!(await canAccessLead(user, lead))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let reason = 'Archived by user';
  try {
    const body = await req.json();
    if (body?.archiveReason) {
      reason = body.archiveReason;
    }
  } catch {
    // Request has no JSON body, ignore
  }

  // An archived lead must stop receiving every cadence, not only the one its pointer names.
  await unenrollAllLeadCadences(id);

  await prisma.lead.update({
    where: { id },
    data: {
      archivedAt: new Date(),
      archivedById: user.id,
      archiveReason: reason,
    },
  });

  // Hook Contact Intelligence evidence
  await onSuppressionOrArchive({
    leadId: id,
    reason: 'archived',
    tenantId: lead.tenantId || user.tenantId || '',
    actorId: user.id,
  });

  return NextResponse.json({ success: true });
}
