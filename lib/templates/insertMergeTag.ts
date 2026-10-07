/**
 * Put `{{field}}` where the cursor is in a one-line field (a template subject), replacing any
 * selected text, and say where the cursor goes next. A selection out of range — the field was
 * edited since it was read — is clamped rather than trusted.
 */
export function insertMergeTag(
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
  field: string,
): { value: string; cursor: number } {
  const clamp = (n: number | null) => Math.min(Math.max(n ?? value.length, 0), value.length);
  const start = clamp(selectionStart);
  const end = Math.max(start, clamp(selectionEnd));
  const tag = `{{${field}}}`;
  return { value: value.slice(0, start) + tag + value.slice(end), cursor: start + tag.length };
}
