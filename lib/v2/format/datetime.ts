// SSR-safe date formatting. `toLocaleString()` / `toLocaleDateString()` in a client component is the
// #1 React hydration mismatch: the server renders in the server's timezone/locale, the browser
// re-renders in ITS timezone/locale, the strings differ, hydration fails. These formatters pin locale
// to en-US and timeZone to UTC so the server and the client always produce the identical string.
//
// For a RELATIVE time ("2h ago") the value depends on `now`, which differs between server and client
// by nature — wrap those in an element with `suppressHydrationWarning` (React's intended escape hatch
// for timestamps) rather than trying to make them deterministic.

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Deterministic "Mar 4, 2026" (UTC, en-US) — identical on server + client. */
export function formatDate(value: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  return d ? DATE_FMT.format(d) : fallback;
}

/** Deterministic "Mar 4, 2026, 14:05 UTC" — identical on server + client. */
export function formatDateTime(value: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  return d ? `${DATETIME_FMT.format(d)} UTC` : fallback;
}

// Number grouping is ALSO locale-dependent: a bare `n.toLocaleString()` renders "1,050" on the server
// (en-US) but "1.050" in a vi-VN browser → hydration mismatch. Pin the locale so both agree.
const COUNT_FMT = new Intl.NumberFormat("en-US");

/** Deterministic "1,050" — identical on server + client regardless of browser locale. */
export function formatCount(value: number | bigint | null | undefined): string {
  if (value == null) return "0";
  return COUNT_FMT.format(value);
}

/**
 * Relative time ("just now" / "5m ago" / "3h ago" / "2d ago" / a UTC date past 7 days). Depends on
 * `now`, so a caller in a CLIENT component must render it inside `<span suppressHydrationWarning>`.
 */
export function formatRelative(value: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(d);
}
