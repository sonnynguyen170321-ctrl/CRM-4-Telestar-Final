import { z } from 'zod';

/**
 * What a manager may write on settings/telephony (docs/dialer/TASKS.md D9.2).
 *
 * Pure, so the route and the page share the rules. The tenant is never part of the input — it comes
 * from the session — and the kill switch is a boolean the server turns into `killedAt`/`killedById`.
 */

export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 730;
export const MINUTES_PER_DAY = 1440;
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const MAX_COUNTRIES = 250;
const MAX_LABEL_LENGTH = 80;

export const VIETNAM_REFUSAL =
  'Vietnam cannot be dialled through the provider: Vietnamese numbers are called from the rep\'s own phone and logged in the CRM.';

const countrySchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => /^[A-Z]{2}$/.test(value), 'Use two-letter country codes such as SG or US')
  .refine((value) => value !== 'VN', VIETNAM_REFUSAL);

const minuteSchema = z.number().int().min(0).max(MINUTES_PER_DAY);
const weekdaySchema = z.number().int().min(0).max(6);

const sortedUnique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

export const settingsPatchSchema = z
  .object({
    enabled: z.boolean(),
    dryRun: z.boolean(),
    /** The kill switch: true stops every call for the team now, false lifts it. */
    killed: z.boolean(),
    /** Call at any hour on any day. Expands to 00:00-24:00 and all seven weekdays. */
    anyTime: z.boolean(),
    callingHoursStart: minuteSchema,
    callingHoursEnd: minuteSchema,
    allowedWeekdays: z.array(weekdaySchema).min(1, 'Pick at least one weekday').max(7),
    allowedCountries: z.array(countrySchema).max(MAX_COUNTRIES),
    recordingEnabled: z.boolean(),
    recordingNotice: z.boolean(),
    recordingRetentionDays: z
      .number()
      .int()
      .min(MIN_RETENTION_DAYS, `Keep recordings for at least ${MIN_RETENTION_DAYS} days`)
      .max(MAX_RETENTION_DAYS, `Keep recordings for at most ${MAX_RETENTION_DAYS} days`),
  })
  .partial()
  .strict()
  .superRefine((patch, ctx) => {
    const issue = (message: string, path: string[]) => ctx.addIssue({ code: 'custom', message, path });
    if (Object.values(patch).every((value) => value === undefined)) issue('Nothing to change', []);

    const hasHours = patch.callingHoursStart !== undefined || patch.callingHoursEnd !== undefined;
    if (patch.anyTime === true && (hasHours || patch.allowedWeekdays !== undefined)) {
      issue('"Any time" already covers every hour of every day; do not send hours or weekdays with it', ['anyTime']);
    }
    if (patch.anyTime === false && (patch.callingHoursStart === undefined || patch.callingHoursEnd === undefined || patch.allowedWeekdays === undefined)) {
      issue('Turning "any time" off needs the calling hours and weekdays that replace it', ['anyTime']);
    }
    if (hasHours && (patch.callingHoursStart === undefined || patch.callingHoursEnd === undefined)) {
      issue('Send the start and the end of the calling hours together', ['callingHoursStart']);
    }
    if (patch.callingHoursStart !== undefined && patch.callingHoursEnd !== undefined && patch.callingHoursStart >= patch.callingHoursEnd) {
      issue('Calling hours must start before they end', ['callingHoursEnd']);
    }
  })
  .transform(({ anyTime, ...patch }) => ({
    ...patch,
    ...(anyTime === true ? { callingHoursStart: 0, callingHoursEnd: MINUTES_PER_DAY, allowedWeekdays: ALL_WEEKDAYS } : {}),
    ...(patch.allowedWeekdays ? { allowedWeekdays: sortedUnique(patch.allowedWeekdays) } : {}),
    ...(patch.allowedCountries ? { allowedCountries: [...new Set(patch.allowedCountries)] } : {}),
  }));

export type SettingsPatch = z.output<typeof settingsPatchSchema>;

const labelSchema = z
  .string()
  .trim()
  .max(MAX_LABEL_LENGTH, `Labels are at most ${MAX_LABEL_LENGTH} characters`);

/** A number the account owns. The country is read from the number, never trusted from the client. */
export const numberInputSchema = z
  .object({
    e164: z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'Use international format with no spaces, e.g. +14155550123'),
    label: labelSchema.optional(),
  })
  .strict();

export const numberPatchSchema = z
  .object({
    label: labelSchema,
    isActive: z.boolean(),
    isDefault: z.boolean(),
    isOverallDefault: z.boolean(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), 'Nothing to change');
