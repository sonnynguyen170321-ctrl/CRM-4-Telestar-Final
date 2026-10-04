import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

import { isSuspectedMachine, type VerifiedToken } from './tracking';

/**
 * A repeat hit of the same kind on the same message inside this window is not a new open or click:
 * image proxies and forwarded copies refetch the pixel. It is still stored, but does not count.
 */
export const REPEAT_WINDOW_MS = 60_000;

/**
 * Events stored per message and kind. The routes are public and a token is in every email, so a
 * holder could replay it forever; past this the event is dropped (counts are already settled by
 * then — the first-seen timestamps are what the rates use).
 */
export const MAX_EVENTS_PER_MESSAGE = 200;

/**
 * Record a verified open or click.
 *
 * Runs inside the tenant the signed token names (see `lib/email/tracking.ts`), so every read and
 * write is the ordinary tenant-scoped kind. The message must exist in that tenant; a token for a
 * deleted message records nothing.
 *
 * Every hit becomes an `EmailEvent`, machines included, so the flag can be audited later. Only a
 * hit that is not a suspected machine moves the message's counts and first-seen timestamps, and the
 * first-seen write is conditional so concurrent hits cannot overwrite the earliest one.
 *
 * Never throws: a tracking failure must not turn into a broken image or a dead link in a prospect's
 * inbox. It reports what happened instead.
 */
export async function recordTrackingEvent(input: {
  token: VerifiedToken;
  type: 'open' | 'click';
  url?: string | null;
  userAgent: string | null;
  now?: Date;
}): Promise<'recorded' | 'recorded_as_machine' | 'unknown_message' | 'failed'> {
  const now = input.now ?? new Date();
  const { tenantId, messageId } = input.token;
  try {
    return await tenantStorage.run({ tenantId }, async () => {
      const message = await prisma.outboundMessage.findFirst({
        where: { id: messageId, tenantId },
        select: { id: true, sentAt: true },
      });
      if (!message) return 'unknown_message' as const;

      const stored = await prisma.emailEvent.count({
        where: { tenantId, outboundMessageId: message.id, type: input.type },
      });
      if (stored >= MAX_EVENTS_PER_MESSAGE) return 'recorded_as_machine' as const;

      const machine = isSuspectedMachine({ type: input.type, userAgent: input.userAgent, sentAt: message.sentAt, now });
      const repeat =
        !machine &&
        (await prisma.emailEvent.count({
          where: {
            tenantId,
            outboundMessageId: message.id,
            type: input.type,
            suspectedBot: false,
            createdAt: { gte: new Date(now.getTime() - REPEAT_WINDOW_MS) },
          },
        })) > 0;
      const suspectedBot = machine || repeat;

      await prisma.emailEvent.create({
        data: {
          tenantId,
          outboundMessageId: message.id,
          type: input.type,
          url: input.url ?? null,
          suspectedBot,
          userAgent: input.userAgent?.slice(0, 400) ?? null,
          createdAt: now,
        },
      });
      if (suspectedBot) return 'recorded_as_machine' as const;

      if (input.type === 'open') {
        await prisma.outboundMessage.updateMany({ where: { id: message.id, tenantId }, data: { openCount: { increment: 1 } } });
        await prisma.outboundMessage.updateMany({ where: { id: message.id, tenantId, openedAt: null }, data: { openedAt: now } });
      } else {
        await prisma.outboundMessage.updateMany({ where: { id: message.id, tenantId }, data: { clickCount: { increment: 1 } } });
        await prisma.outboundMessage.updateMany({ where: { id: message.id, tenantId, clickedAt: null }, data: { clickedAt: now } });
        // A click is an open the pixel may have missed (images blocked): count the first one.
        await prisma.outboundMessage.updateMany({ where: { id: message.id, tenantId, openedAt: null }, data: { openedAt: now } });
      }
      return 'recorded' as const;
    });
  } catch (error) {
    console.error('[tracking] could not record event', { type: input.type, messageId, error });
    return 'failed';
  }
}
