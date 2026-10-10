import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/lib/api/errors';
import { noStoreJson, requireTelephonyManager } from '@/lib/telephony/settingsAccess';
import { revokeCredential } from '@/lib/telephony/settingsNumbers';

export const dynamic = 'force-dynamic';

/**
 * Revoke a rep's softphone credential. The rep is refused a token from this moment; the provider's
 * copy is deleted when it can be reached (`providerRevoked` says whether it was), and repeating the
 * request retries just that part.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;

  try {
    const { id } = await params;
    const result = await revokeCredential(manager.tenantId, manager.user.id, id);
    return result.ok ? noStoreJson(result.value) : noStoreJson({ error: result.error }, result.status);
  } catch (error) {
    return handleApiError('api/telephony/settings/credentials/[id] DELETE', error);
  }
}
