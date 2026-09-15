import { getLocalTime, localToUtc } from '@/lib/automation/timezone';
import { describeZone } from './describeZone';

/**
 * One wall-clock time in one zone, rendered in others. The "Convert time" command is a picker
 * over this; it is pure so the palette needs no state of its own beyond the inputs.
 */
export type ConvertedRow = {
  timezone: string;
  /** `12:00` */
  localTime: string;
  /** `Tue` */
  weekday: string;
  /** `GMT+7` */
  offsetLabel: string;
  /** -1, 0 or +1: the calendar day in this zone relative to the source zone's day. */
  dayShift: -1 | 0 | 1;
  isBusinessHours: boolean;
};

export function convertTime(input: {
  /** `YYYY-MM-DD`, read in `fromZone`. */
  date: string;
  hour: number;
  minute: number;
  fromZone: string;
  toZones: string[];
}): ConvertedRow[] {
  const [y, m, d] = input.date.split('-').map(Number);
  const instant = localToUtc(y, m, d, input.hour, input.minute, input.fromZone);
  const sourceDay = Date.UTC(y, m - 1, d);

  return input.toZones.map((timezone) => {
    const desc = describeZone(timezone, instant);
    const local = getLocalTime(instant, timezone);
    const targetDay = Date.UTC(local.year, local.month - 1, local.day);
    const shift = Math.round((targetDay - sourceDay) / 86_400_000);
    return {
      timezone,
      localTime: desc.localTime,
      weekday: desc.weekday,
      offsetLabel: desc.offsetLabel,
      dayShift: (shift < 0 ? -1 : shift > 0 ? 1 : 0) as -1 | 0 | 1,
      isBusinessHours: desc.isBusinessHours,
    };
  });
}
