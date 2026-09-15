'use client';

import { useState } from 'react';
import { Check, Clock } from 'lucide-react';
import LocalClock from './LocalClock';
import TimezoneSelect from './TimezoneSelect';
import { inferTimezone } from '@/lib/time/inferTimezone';
import { zoneCityName } from '@/lib/time/describeZone';

/**
 * The prospect's local time on the lead panel, and the one place their timezone gets set.
 *
 * Three states, decided by what the CRM knows:
 *  - `lead.timezone` set → the clock, plain.
 *  - unknown but inferable (single-zone country, or an international phone prefix) → the clock
 *    with an "inferred" badge and a Confirm button. Nothing is written until someone confirms:
 *    `lead.timezone` decides when sequence email goes out, and a wrong value written silently
 *    would shift a prospect's send window with no one knowing.
 *  - unknown and not inferable (no country, local phone, or a multi-zone country such as the US)
 *    → "timezone unknown" with a picker.
 */
export default function ProspectClock({
  timezone,
  country,
  phone,
  onConfirm,
}: {
  timezone: string | null | undefined;
  country?: string | null;
  phone?: string | null;
  /** Persist the zone. Resolves when saved; rejects (with a message) when not. */
  onConfirm: (timezone: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState('');

  const inferred = timezone ? null : inferTimezone({ country, phone });

  async function confirm(zone: string) {
    setSaving(true);
    try {
      await onConfirm(zone);
    } finally {
      setSaving(false);
    }
  }

  if (timezone) {
    return (
      <div className="flex items-center gap-2 mt-1" title={timezone}>
        <LocalClock timezone={timezone} />
        <span className="text-[10px] text-text-muted">{zoneCityName(timezone)}</span>
      </div>
    );
  }

  if (inferred) {
    return (
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <LocalClock timezone={inferred.timezone} />
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          title={`${inferred.timezone} — inferred ${inferred.reason}. Not saved until confirmed.`}
        >
          {zoneCityName(inferred.timezone)} · inferred {inferred.reason}
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => confirm(inferred.timezone)}
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
          title="Save this timezone on the lead. Sequence send windows will use it."
        >
          <Check className="w-3 h-3" /> Confirm
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      <span className="inline-flex items-center gap-1 text-[10px] text-text-muted">
        <Clock className="w-3 h-3" /> Timezone unknown
      </span>
      <TimezoneSelect value={picked} onChange={setPicked} allowEmpty className="py-0.5 text-[10px]" />
      <button
        type="button"
        disabled={!picked || saving}
        onClick={() => confirm(picked)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
      >
        <Check className="w-3 h-3" /> Set
      </button>
    </div>
  );
}
