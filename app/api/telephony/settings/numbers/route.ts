import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/lib/api/errors';
import { parseBody } from '@/lib/validation/core';
import { limitWrites, noStoreJson, requireTelephonyAdmin } from '@/lib/telephony/settingsAccess';
import { numberInputSchema } from '@/lib/telephony/settingsInput';
import { addNumber } from '@/lib/telephony/settingsNumbers';

export const dynamic = 'force-dynamic';

const NUMBER_WRITES_PER_MINUTE = 30;

/** Add a caller-ID number the account owns (E.164; the country is read from the number). */
export async function POST(req: NextRequest) {
  const manager = await requireTelephonyAdmin();
  if (manager instanceof NextResponse) return manager;
  const limited = await limitWrites(manager.user, 'telephony-number-write', NUMBER_WRITES_PER_MINUTE);
  if (limited) return limited;

  const parsed = await parseBody(req, numberInputSchema, 'Invalid phone number');
  if (parsed.error) return parsed.error;

  try {
    const result = await addNumber(manager.tenantId, manager.user.id, parsed.data);
    return result.ok ? noStoreJson({ number: result.value }, 201) : noStoreJson({ error: result.error }, result.status);
  } catch (error) {
    return handleApiError('api/telephony/settings/numbers POST', error);
  }
}
