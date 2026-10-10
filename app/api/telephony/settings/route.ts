import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/lib/api/errors';
import { parseBody } from '@/lib/validation/core';
import { applySettingsPatch, deploymentState, loadSettingsDto } from '@/lib/telephony/settingsAdmin';
import { noStoreJson, requireTelephonyManager } from '@/lib/telephony/settingsAccess';
import { listCredentials, listNumbers } from '@/lib/telephony/settingsNumbers';
import { settingsPatchSchema } from '@/lib/telephony/settingsInput';

export const dynamic = 'force-dynamic';

/**
 * The team's dialer settings for managers (docs/dialer/TASKS.md D9.2): the saved settings, the
 * deployment's switches by state only (never a value), the caller-ID numbers and the softphone
 * credentials. Directors, floor managers and team leads, for their own team; never an API key.
 */
export async function GET() {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;

  try {
    const [settings, numbers, credentials] = await Promise.all([
      loadSettingsDto(manager.tenantId),
      listNumbers(manager.tenantId),
      listCredentials(manager.tenantId),
    ]);
    return noStoreJson({ settings, deployment: deploymentState(manager.tenantId), numbers, credentials });
  } catch (error) {
    return handleApiError('api/telephony/settings GET', error);
  }
}

export async function PATCH(req: NextRequest) {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;

  const parsed = await parseBody(req, settingsPatchSchema, 'Invalid dialer settings');
  if (parsed.error) return parsed.error;

  try {
    const settings = await applySettingsPatch(manager.tenantId, manager.user.id, parsed.data);
    return noStoreJson({ settings });
  } catch (error) {
    return handleApiError('api/telephony/settings PATCH', error);
  }
}
