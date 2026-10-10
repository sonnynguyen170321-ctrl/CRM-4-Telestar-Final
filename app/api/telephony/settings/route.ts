import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/lib/api/errors';
import { getVisibleUserIds } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { applySettingsPatch, deploymentState, loadSettingsDto } from '@/lib/telephony/settingsAdmin';
import { noStoreJson, requireTelephonyManager } from '@/lib/telephony/settingsAccess';
import { listCredentials, listNumbers } from '@/lib/telephony/settingsNumbers';
import { settingsPatchSchema } from '@/lib/telephony/settingsInput';

export const dynamic = 'force-dynamic';

/**
 * The team's dialer settings for managers (docs/dialer/TASKS.md D9.2): the saved settings, the
 * deployment's switches by state only (never a value), the caller-ID numbers and the softphone
 * credentials. Directors, floor managers and team leads, for their own team; never an API key. A team
 * lead sees it read-only (`readOnly: true`), with only their own reps' logins.
 */
export async function GET() {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;

  try {
    const [settings, numbers, credentials] = await Promise.all([
      loadSettingsDto(manager.tenantId),
      listNumbers(manager.tenantId),
      listCredentials(manager.tenantId, manager.isAdmin ? null : await getVisibleUserIds(manager.user)),
    ]);
    return noStoreJson({ readOnly: !manager.isAdmin, settings, deployment: deploymentState(manager.tenantId), numbers, credentials });
  } catch (error) {
    return handleApiError('api/telephony/settings GET', error);
  }
}

export async function PATCH(req: NextRequest) {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;

  const parsed = await parseBody(req, settingsPatchSchema, 'Invalid dialer settings');
  if (parsed.error) return parsed.error;
  // A team lead may press the emergency stop and nothing else; lifting it, like every other setting, is for a director or floor manager.
  if (!manager.isAdmin) {
    const onlyStop = Object.keys(parsed.data).length === 1 && parsed.data.killed === true;
    if (!onlyStop) return noStoreJson({ error: 'A team lead can use the emergency stop only. Other changes need a director or floor manager.' }, 403);
  }

  try {
    const settings = await applySettingsPatch(manager.tenantId, manager.user.id, parsed.data);
    return noStoreJson({ settings });
  } catch (error) {
    return handleApiError('api/telephony/settings PATCH', error);
  }
}
