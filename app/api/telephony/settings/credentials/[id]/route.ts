import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/lib/api/errors';
import { canAccessUser } from '@/lib/auth';
import { limitWrites, noStoreJson, requireTelephonyManager } from '@/lib/telephony/settingsAccess';
import { revokeCredential } from '@/lib/telephony/settingsNumbers';

export const dynamic = 'force-dynamic';

const REVOKES_PER_MINUTE = 20;

/**
 * Revoke a rep's softphone credential. The rep is refused a token from this moment; the provider's
 * copy is deleted when it can be reached (`providerRevoked` says whether it was), and repeating the
 * request retries just that part. A director or floor manager may revoke any rep's login; a team lead
 * only a rep in their own report chain (anyone else's is a 404).
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;
  const limited = await limitWrites(manager.user, 'telephony-revoke', REVOKES_PER_MINUTE);
  if (limited) return limited;

  try {
    const { id } = await params;
    const result = await revokeCredential(
      manager.tenantId,
      manager.user.id,
      id,
      manager.isAdmin ? undefined : (userId) => canAccessUser(manager.user, userId)
    );
    return result.ok ? noStoreJson(result.value) : noStoreJson({ error: result.error }, result.status);
  } catch (error) {
    return handleApiError('api/telephony/settings/credentials/[id] DELETE', error);
  }
}
