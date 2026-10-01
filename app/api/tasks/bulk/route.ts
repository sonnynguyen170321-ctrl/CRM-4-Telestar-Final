import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { bulkTaskActionSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { applyBulkTaskAction } from '@/lib/tasks/bulkAction';

/**
 * Apply one action to many tasks.
 *
 * The per-task rules live in `lib/tasks/bulkAction.ts`, shared with the chat assistant's
 * `update_tasks` / `complete_tasks` tools so there is exactly one implementation of them.
 *
 * The authorization is unchanged, and is the reason that module is shared rather than copied: every
 * task is checked individually inside it — `canAccessUser` on its owner, or `canAccessLead` on its
 * lead — so a caller can never bulk-edit another rep's tasks by naming their ids. Tasks that fail a
 * check, or that are already closed, come back in `failed[]` rather than failing the whole request.
 *
 * What stays here is what is genuinely HTTP: the session, body validation, and turning a refused
 * reassignment target into a 403.
 */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, bulkTaskActionSchema, 'Invalid bulk task action');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const result = await applyBulkTaskAction(
      user,
      {
        action: body.action,
        taskIds: body.taskIds,
        dueDate: body.dueDate,
        userId: body.userId,
        note: body.note,
        outcome: body.outcome,
      },
      'human'
    );

    // The reassignment target was not someone this user manages, and nothing was written.
    if (result.refusedTarget) {
      return NextResponse.json({ error: 'Forbidden: cannot assign to that user' }, { status: 403 });
    }

    return NextResponse.json({
      action: body.action,
      updated: result.updated,
      failed: result.failed,
    });
  } catch (err) {
    return handleApiError('api/tasks/bulk POST', err);
  }
}
