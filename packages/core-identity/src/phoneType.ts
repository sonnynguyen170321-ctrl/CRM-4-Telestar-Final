import { parsePhoneNumberFromString } from "libphonenumber-js/max";

// What kind of line an E.164 number is (mobile, fixed line, premium rate, …). Needs libphonenumber's
// full metadata, which is ~150 KB, so it lives behind its own export path ("./phone-type") and is
// never pulled into a browser bundle through the package root. The root's normalizer uses the small
// metadata, which validates by length only — it cannot tell a premium-rate 1900 number from a mobile.

export type PhoneLineType = NonNullable<ReturnType<NonNullable<ReturnType<typeof parsePhoneNumberFromString>>["getType"]>>;

/** The line type of an E.164 number, or null when it does not parse or the type is unknown. */
export function phoneLineType(e164: string | null | undefined): PhoneLineType | null {
  if (!e164) return null;
  return parsePhoneNumberFromString(e164)?.getType() ?? null;
}
