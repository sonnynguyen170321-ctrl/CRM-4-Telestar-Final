import { normalizeHeaderName } from "./hash";

// Real SDR exports (the activity-recap files) routinely have blank header cells (trailing
// empty columns) and repeated header names (many "Company …" columns truncate to the same
// text). The old upload path HARD-REJECTED both ("CSV contains a blank header" /
// "headers must be unique"), so valid files bounced at step 1. Instead we SANITIZE:
//
//   - blank cell        -> "Column {n}"  (1-based position)
//   - duplicate name    -> "Name (2)", "Name (3)", …
//
// Display names stay human-readable (the mock shows the original header in mapping). The
// dedup base is normalizeHeaderName(display), which mirrors how the streaming parser
// (parseCsvRows) keys rawRowJson — so "Company (2)" -> "company_2" lines up with the
// parser's "company_2", and "Column 5" -> "column_5" lines up with the parser's blank fill
// "column_{index+1}". That keeps the mapping UI's source header resolvable to a real key.
export function sanitizeDisplayHeaders(rawHeaders: string[]): string[] {
  const seenBase = new Map<string, number>();

  return rawHeaders.map((raw, index) => {
    const trimmed = raw.trim();
    const display = trimmed === "" ? `Column ${index + 1}` : trimmed;
    const base = normalizeHeaderName(display) || `column_${index + 1}`;
    const count = seenBase.get(base) ?? 0;
    seenBase.set(base, count + 1);

    return count === 0 ? display : `${display} (${count + 1})`;
  });
}
