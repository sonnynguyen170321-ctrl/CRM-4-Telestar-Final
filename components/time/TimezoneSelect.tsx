'use client';

import { TIMEZONE_OPTIONS } from '@/lib/time/options';

/**
 * A `<select>` over every IANA zone, the company's own zones first.
 *
 * A native select rather than a searchable combobox: it is keyboard-accessible for free, works
 * on the phone, and with the pinned group on top the common case is two keystrokes.
 */
export default function TimezoneSelect({
  value,
  onChange,
  id,
  className = '',
  allowEmpty = false,
  disabled = false,
}: {
  value: string;
  onChange: (timezone: string) => void;
  id?: string;
  className?: string;
  /** Offer a blank first option, for "not set". */
  allowEmpty?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs ${className}`}
    >
      {allowEmpty && <option value="">— not set —</option>}
      {TIMEZONE_OPTIONS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.zones.map((z) => (
            <option key={`${group.label}:${z.id}`} value={z.id}>
              {z.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
