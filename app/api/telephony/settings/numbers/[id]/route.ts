import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/lib/api/errors';
import { parseBody } from '@/lib/validation/core';
import { noStoreJson, requireTelephonyManager } from '@/lib/telephony/settingsAccess';
import { numberPatchSchema } from '@/lib/telephony/settingsInput';
import { removeNumber, updateNumber } from '@/lib/telephony/settingsNumbers';

export const dynamic = 'force-dynamic';

/** Relabel, switch on/off, or make a number the default for its country or overall. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;

  const parsed = await parseBody(req, numberPatchSchema, 'Invalid number change');
  if (parsed.error) return parsed.error;

  try {
    const { id } = await params;
    const result = await updateNumber(manager.tenantId, manager.user.id, id, parsed.data);
    return result.ok ? noStoreJson({ number: result.value }) : noStoreJson({ error: result.error }, result.status);
  } catch (error) {
    return handleApiError('api/telephony/settings/numbers/[id] PATCH', error);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;

  try {
    const { id } = await params;
    const result = await removeNumber(manager.tenantId, manager.user.id, id);
    return result.ok ? noStoreJson({ deleted: true }) : noStoreJson({ error: result.error }, result.status);
  } catch (error) {
    return handleApiError('api/telephony/settings/numbers/[id] DELETE', error);
  }
}
