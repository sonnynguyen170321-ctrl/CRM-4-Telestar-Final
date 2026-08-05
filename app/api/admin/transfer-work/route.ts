import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { transferWork } from '@/lib/admin/transferWork';
import { parseBody } from '@/lib/validation/core';
import { transferWorkSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';

/**
 * Move one user's live work to another. All authorization and scoping lives in
 * `lib/admin/transferWork.ts` so the same rules apply when the campaign-member
 * removal flow calls it internally.
 *
 * Retry-safe: re-POSTing the same `requestId` returns the original result
 * without moving anything twice.
 */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, transferWorkSchema, 'Invalid transfer request');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const result = await transferWork(user, {
      fromUserId: body.fromUserId,
      toUserId: body.toUserId,
      campaignId: body.campaignId,
      include: {
        leads: body.includeLeads,
        openTasks: body.includeOpenTasks,
        scheduledMeetings: body.includeScheduledMeetings,
        openOpportunities: body.includeOpenOpportunities,
      },
      requestId: body.requestId,
      reason: body.reason,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError('api/admin/transfer-work POST', err);
  }
}
