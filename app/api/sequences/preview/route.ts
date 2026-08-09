import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { handleApiError } from '@/lib/api/errors';
import { calculateNextActionAt } from '@/lib/automation/scheduling';
import { resolveTimezone } from '@/lib/automation/timezone';
import { buildJitterSeed } from '@/lib/automation/jitter';

/**
 * Cadence preview for the sequence builder (spec §28).
 *
 * Runs on the server on purpose: the preview has to agree with what the worker will
 * actually do, and the scheduler's deterministic jitter is a node:crypto hash. Computing
 * it again in the browser would mean a second implementation that drifts from the first,
 * and a preview that quietly lies is worse than no preview.
 *
 * Takes steps as a body rather than a sequence id so unsaved edits can be previewed.
 */

const previewStepSchema = z.object({
  order: z.number().int().min(1).optional(),
  channel: z.enum(['email', 'phone', 'linkedin', 'whatsapp']),
  delayDays: z.number().int().min(0).max(365).optional(),
  delayHours: z.number().int().min(0).max(23).optional(),
  autoComplete: z.boolean().optional(),
  sendWindowStartMinutes: z.number().int().min(0).max(1439).nullish().optional(),
  sendWindowEndMinutes: z.number().int().min(0).max(1439).nullish().optional(),
});

const previewSchema = z.object({
  steps: z.array(previewStepSchema).max(50),
  timezone: z.string().max(64).optional(),
  /** Stable ids make the preview match a real enrollment; omitted for a generic preview. */
  sequenceId: z.string().max(64).optional(),
  leadId: z.string().max(64).optional(),
  startAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, previewSchema, 'Invalid preview request');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const timezone = resolveTimezone(body.timezone);
    let cursor = body.startAt ? new Date(body.startAt) : new Date();

    const steps = body.steps.map((step, idx) => {
      const order = step.order ?? idx + 1;
      const seed = buildJitterSeed({
        tenantId: user.tenantId ?? undefined,
        sequenceId: body.sequenceId,
        // A preview of unsaved steps has no step id yet; the order stands in for it so
        // the spread still differs per step instead of collapsing to one offset.
        sequenceStepId: String(order),
        leadId: body.leadId,
      });

      const sched = calculateNextActionAt({
        baseAt: cursor,
        delayDays: step.delayDays ?? 1,
        delayHours: step.delayHours ?? 0,
        sendWindowStartMinutes: step.sendWindowStartMinutes ?? null,
        sendWindowEndMinutes: step.sendWindowEndMinutes ?? null,
        timezone,
        businessDayPolicy: 'skip_weekends',
        deterministicSeed: seed,
      });

      // Each step's cadence is measured from the previous step, matching the engine's
      // one-task-at-a-time advance.
      cursor = sched.dueAtUtc;

      return {
        order,
        channel: step.channel,
        isAutomated: step.autoComplete ?? false,
        dueAtUtc: sched.dueAtUtc.toISOString(),
        dueAtLocal: sched.dueAtLocal,
        adjustmentReason: sched.adjustmentReason,
        hasSendWindow:
          step.sendWindowStartMinutes != null && step.sendWindowEndMinutes != null,
      };
    });

    return NextResponse.json({ timezone, steps });
  } catch (err) {
    return handleApiError('api/sequences/preview POST', err);
  }
}
