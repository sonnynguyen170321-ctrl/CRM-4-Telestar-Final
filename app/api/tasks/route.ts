import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { createTaskSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { getTasks, createTask } from '@/lib/tasks/service';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const tab = searchParams.get('tab');
  const leadId = searchParams.get('leadId');
  const scopeUserId = searchParams.get('userId');

  try {
    const tasks = await getTasks(user, {
      tab,
      leadId,
      scopeUserId,
    });
    
    return NextResponse.json(tasks);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return handleApiError('api/tasks GET', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createTaskSchema, 'Invalid task create');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const task = await createTask(user, {
      leadId: body.leadId,
      userId: body.userId,
      type: body.type,
      title: body.title,
      description: body.description ?? undefined,
      dueDate: new Date(body.dueDate),
      sequenceId: body.sequenceId ?? undefined,
      sequenceStep: body.sequenceStep ?? undefined,
      priority: body.priority,
    });

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Forbidden')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (err instanceof Error && err.message === 'Lead not found') {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    return handleApiError('api/tasks POST', err);
  }
}
