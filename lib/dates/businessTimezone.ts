import { prisma } from '@/lib/prisma';
import { resolveTimezone } from '@/lib/automation/timezone';

/**
 * The timezone a follow-up task's "next business day" should be computed in.
 *
 * Same precedence the sequence engine uses for send windows (lib/automation/eligibility.ts):
 * the lead's own timezone, then the assignee's, then the app default. A due date and a send
 * window must agree on what "morning" means for the same person.
 *
 * Note for operators: `User.timezone` defaults to `"UTC"` in the schema. A rep who has never
 * opened Settings therefore resolves to UTC unless the lead carries a timezone — the helper is
 * now correct, but the answer it gives is only as good as the data it is handed.
 */
export async function businessTimezoneFor(input: {
  leadTimezone?: string | null;
  assigneeId?: string | null;
}): Promise<string> {
  const assignee = input.assigneeId
    ? await prisma.user.findUnique({ where: { id: input.assigneeId }, select: { timezone: true } })
    : null;
  return resolveTimezone(input.leadTimezone, assignee?.timezone);
}
