import 'server-only';

import { isDemoTenant } from '@/lib/emailSafety';
import { logAdminAudit, type AdminAuditAction } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

import { isTelephonyConfigured, isTelephonyEnabled, missingTelephonyEnv } from './flags';
import { DEFAULT_RETENTION_DAYS, MINUTES_PER_DAY, type SettingsPatch } from './settingsInput';

/**
 * Reading and changing a team's dialer settings (docs/dialer/TASKS.md D9.2). Every function takes
 * the tenant from the caller's session; the routes pass nothing from the request body or URL.
 *
 * Nothing secret is read here: the deployment block names the variables that are missing, never a value.
 */

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** The fields a manager edits, as stored; also exactly what the audit trail records before and after. */
const EDITABLE_KEYS = [
  'enabled',
  'dryRun',
  'callingHoursStart',
  'callingHoursEnd',
  'allowedWeekdays',
  'allowedCountries',
  'recordingEnabled',
  'recordingNotice',
  'recordingRetentionDays',
] as const;
type EditableKey = (typeof EDITABLE_KEYS)[number];
type EditableValues = {
  enabled: boolean;
  dryRun: boolean;
  callingHoursStart: number;
  callingHoursEnd: number;
  allowedWeekdays: number[];
  allowedCountries: string[];
  recordingEnabled: boolean;
  recordingNotice: boolean;
  recordingRetentionDays: number;
};

const DEFAULTS: EditableValues = {
  enabled: false,
  dryRun: true,
  callingHoursStart: 0,
  callingHoursEnd: MINUTES_PER_DAY,
  allowedWeekdays: ALL_WEEKDAYS,
  allowedCountries: [],
  recordingEnabled: true,
  recordingNotice: false,
  recordingRetentionDays: DEFAULT_RETENTION_DAYS,
};

type StoredSettings = (EditableValues & { id: string; killedAt: Date | null; killedById: string | null; updatedAt: Date }) | null;

const isAnyTime = (v: EditableValues) =>
  v.callingHoursStart <= 0 && v.callingHoursEnd >= MINUTES_PER_DAY && ALL_WEEKDAYS.every((day) => v.allowedWeekdays.includes(day));

const valuesOf = (row: StoredSettings): EditableValues =>
  row ? Object.fromEntries(EDITABLE_KEYS.map((key) => [key, row[key]])) as EditableValues : DEFAULTS;

export type SettingsDto = EditableValues & {
  anyTime: boolean;
  killed: boolean;
  killedAt: string | null;
  killedByName: string | null;
  updatedAt: string | null;
};

async function userName(tenantId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { firstName: true, lastName: true } });
  return user ? `${user.firstName} ${user.lastName}`.trim() : null;
}

async function toDto(tenantId: string, row: StoredSettings): Promise<SettingsDto> {
  const values = valuesOf(row);
  return {
    ...values,
    anyTime: isAnyTime(values),
    killed: Boolean(row?.killedAt),
    killedAt: row?.killedAt?.toISOString() ?? null,
    killedByName: await userName(tenantId, row?.killedById ?? null),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** Switches that live in the environment, shown read-only: state only, never a value. */
export function deploymentState(tenantId: string) {
  return {
    enabledFlag: process.env.TELEPHONY_ENABLED === 'true',
    dryRunFlag: process.env.TELEPHONY_DRY_RUN !== 'false',
    configured: isTelephonyConfigured(),
    missing: missingTelephonyEnv(),
    demoTenant: isDemoTenant(tenantId),
    effectiveEnabled: isTelephonyEnabled(tenantId),
  };
}

const findSettings = (tenantId: string) => prisma.telephonySettings.findUnique({ where: { tenantId } }) as Promise<StoredSettings>;

export async function loadSettingsDto(tenantId: string): Promise<SettingsDto> {
  return toDto(tenantId, await findSettings(tenantId));
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const audit = (tenantId: string, input: Parameters<typeof logAdminAudit>[0]) => tenantStorage.run({ tenantId }, () => logAdminAudit(input));

function changedFields(before: EditableValues, patch: Partial<EditableValues>) {
  const keys = EDITABLE_KEYS.filter((key: EditableKey) => patch[key] !== undefined && !sameValue(before[key], patch[key]));
  return {
    keys,
    before: Object.fromEntries(keys.map((key) => [key, before[key]])),
    after: Object.fromEntries(keys.map((key) => [key, patch[key]])),
  };
}

/**
 * Apply a validated patch. The kill switch is a boolean here: pressing it twice keeps the first time
 * and person. Each change that matters is audited with its before and after; a save that changes
 * nothing writes nothing.
 */
export async function applySettingsPatch(tenantId: string, actorId: string, patch: SettingsPatch): Promise<SettingsDto> {
  const { killed, ...fields } = patch;
  const existing = await findSettings(tenantId);
  const diff = changedFields(valuesOf(existing), fields);

  let killChange: boolean | null = null;
  if (killed === true && !existing?.killedAt) killChange = true;
  if (killed === false && existing?.killedAt) killChange = false;

  if (!existing || diff.keys.length > 0 || killChange !== null) {
    const kill =
      killChange === true ? { killedAt: new Date(), killedById: actorId } : killChange === false ? { killedAt: null, killedById: null } : {};
    const row = await prisma.telephonySettings.upsert({
      where: { tenantId },
      create: { tenantId, ...fields, ...kill, updatedById: actorId },
      update: { ...fields, ...kill, updatedById: actorId },
    });
    const recordId = row.id;
    if (diff.keys.length > 0) {
      await audit(tenantId, {
        actorId,
        action: 'admin.telephony.settings' satisfies AdminAuditAction,
        tableName: 'TelephonySettings',
        recordId,
        changedFields: { before: diff.before, after: diff.after },
      });
    }
    if (killChange !== null) {
      await audit(tenantId, {
        actorId,
        action: 'admin.telephony.kill',
        tableName: 'TelephonySettings',
        recordId,
        changedFields: { before: { killed: !killChange }, after: { killed: killChange } },
      });
    }
  }
  return loadSettingsDto(tenantId);
}
