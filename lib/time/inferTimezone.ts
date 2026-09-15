/**
 * Infer a prospect's timezone from what the CRM already knows about them.
 *
 * Deliberately conservative. The result is shown beside a Confirm button that writes
 * `lead.timezone`, and that column decides when sequence email goes out — so a wrong answer that
 * looks confident is worse than none. Only countries with exactly one timezone are named; the
 * multi-zone ones (US, Canada, Australia, Brazil, Russia, Mexico, Indonesia, …) return null and
 * the UI says "timezone unknown — pick one". The council that reviewed this cut a "guess the
 * capital city" tier for that reason.
 *
 * Pure: no I/O, no clock. Table-tested.
 */

export type TimezoneInference = {
  timezone: string;
  /** Always `exact` today; the field exists so a future looser tier cannot be mistaken for it. */
  confidence: 'exact';
  /** Human-readable, shown in the badge: "from country Singapore" / "from +65". */
  reason: string;
};

/** Country → IANA zone, single-zone countries only. Keys are normalised (see `normalise`). */
const COUNTRY_ZONES: Record<string, string> = {
  // South-east / East Asia — where this company's prospects are
  singapore: 'Asia/Singapore', sg: 'Asia/Singapore',
  vietnam: 'Asia/Ho_Chi_Minh', 'viet nam': 'Asia/Ho_Chi_Minh', vn: 'Asia/Ho_Chi_Minh',
  malaysia: 'Asia/Kuala_Lumpur', my: 'Asia/Kuala_Lumpur',
  thailand: 'Asia/Bangkok', th: 'Asia/Bangkok',
  philippines: 'Asia/Manila', ph: 'Asia/Manila',
  'hong kong': 'Asia/Hong_Kong', hk: 'Asia/Hong_Kong',
  taiwan: 'Asia/Taipei', tw: 'Asia/Taipei',
  japan: 'Asia/Tokyo', jp: 'Asia/Tokyo',
  'south korea': 'Asia/Seoul', korea: 'Asia/Seoul', kr: 'Asia/Seoul',
  cambodia: 'Asia/Phnom_Penh', kh: 'Asia/Phnom_Penh',
  laos: 'Asia/Vientiane', la: 'Asia/Vientiane',
  myanmar: 'Asia/Yangon', mm: 'Asia/Yangon',
  india: 'Asia/Kolkata', in: 'Asia/Kolkata',
  'sri lanka': 'Asia/Colombo', lk: 'Asia/Colombo',
  'united arab emirates': 'Asia/Dubai', uae: 'Asia/Dubai', ae: 'Asia/Dubai',
  israel: 'Asia/Jerusalem', il: 'Asia/Jerusalem',
  'new zealand': 'Pacific/Auckland', nz: 'Pacific/Auckland',
  // Europe
  'united kingdom': 'Europe/London', uk: 'Europe/London', gb: 'Europe/London', england: 'Europe/London',
  ireland: 'Europe/Dublin', ie: 'Europe/Dublin',
  france: 'Europe/Paris', fr: 'Europe/Paris',
  germany: 'Europe/Berlin', de: 'Europe/Berlin',
  netherlands: 'Europe/Amsterdam', nl: 'Europe/Amsterdam',
  belgium: 'Europe/Brussels', be: 'Europe/Brussels',
  switzerland: 'Europe/Zurich', ch: 'Europe/Zurich',
  austria: 'Europe/Vienna', at: 'Europe/Vienna',
  italy: 'Europe/Rome', it: 'Europe/Rome',
  spain: 'Europe/Madrid', es: 'Europe/Madrid',
  portugal: 'Europe/Lisbon', pt: 'Europe/Lisbon',
  sweden: 'Europe/Stockholm', se: 'Europe/Stockholm',
  norway: 'Europe/Oslo', no: 'Europe/Oslo',
  denmark: 'Europe/Copenhagen', dk: 'Europe/Copenhagen',
  finland: 'Europe/Helsinki', fi: 'Europe/Helsinki',
  poland: 'Europe/Warsaw', pl: 'Europe/Warsaw',
  // Africa / Middle East
  'south africa': 'Africa/Johannesburg', za: 'Africa/Johannesburg',
  'saudi arabia': 'Asia/Riyadh', sa: 'Asia/Riyadh',
  qatar: 'Asia/Qatar', qa: 'Asia/Qatar',
  turkey: 'Europe/Istanbul', tr: 'Europe/Istanbul',
};

/** Phone country calling code → zone, again single-zone countries only. Longest code wins. */
const PHONE_ZONES: Record<string, string> = {
  '65': 'Asia/Singapore',
  '84': 'Asia/Ho_Chi_Minh',
  '60': 'Asia/Kuala_Lumpur',
  '66': 'Asia/Bangkok',
  '63': 'Asia/Manila',
  '852': 'Asia/Hong_Kong',
  '886': 'Asia/Taipei',
  '81': 'Asia/Tokyo',
  '82': 'Asia/Seoul',
  '855': 'Asia/Phnom_Penh',
  '856': 'Asia/Vientiane',
  '95': 'Asia/Yangon',
  '91': 'Asia/Kolkata',
  '94': 'Asia/Colombo',
  '971': 'Asia/Dubai',
  '972': 'Asia/Jerusalem',
  '64': 'Pacific/Auckland',
  '44': 'Europe/London',
  '353': 'Europe/Dublin',
  '33': 'Europe/Paris',
  '49': 'Europe/Berlin',
  '31': 'Europe/Amsterdam',
  '32': 'Europe/Brussels',
  '41': 'Europe/Zurich',
  '43': 'Europe/Vienna',
  '39': 'Europe/Rome',
  '34': 'Europe/Madrid',
  '351': 'Europe/Lisbon',
  '46': 'Europe/Stockholm',
  '47': 'Europe/Oslo',
  '45': 'Europe/Copenhagen',
  '358': 'Europe/Helsinki',
  '48': 'Europe/Warsaw',
  '27': 'Africa/Johannesburg',
  '966': 'Asia/Riyadh',
  '974': 'Asia/Qatar',
  '90': 'Europe/Istanbul',
  // +1 (US/Canada), +61 (Australia), +55, +7, +52, +62, +86 are absent on purpose.
};

const PHONE_CODES_LONGEST_FIRST = Object.keys(PHONE_ZONES).sort((a, b) => b.length - a.length);

/** Lower-case, trimmed, diacritics stripped, so "Việt Nam" and "VIETNAM " both hit the table. */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function fromCountry(country: string): TimezoneInference | null {
  const zone = COUNTRY_ZONES[normalise(country)];
  return zone ? { timezone: zone, confidence: 'exact', reason: `from country ${country.trim()}` } : null;
}

function fromPhone(phone: string): TimezoneInference | null {
  // Only an international prefix says which country. A bare local number could be anywhere.
  const digits = phone.replace(/[^\d+]/g, '');
  const intl = digits.startsWith('+') ? digits.slice(1) : digits.startsWith('00') ? digits.slice(2) : null;
  if (!intl) return null;
  for (const code of PHONE_CODES_LONGEST_FIRST) {
    if (intl.startsWith(code)) {
      return { timezone: PHONE_ZONES[code], confidence: 'exact', reason: `from +${code}` };
    }
  }
  return null;
}

export function inferTimezone(input: { country?: string | null; phone?: string | null }): TimezoneInference | null {
  if (input.country?.trim()) {
    const byCountry = fromCountry(input.country);
    if (byCountry) return byCountry;
    // A known multi-zone country is a definite "don't know"; fall through to the phone only when
    // the country was unrecognised, since the phone cannot disambiguate a country we already know.
    if (MULTI_ZONE.has(normalise(input.country))) return null;
  }
  if (input.phone?.trim()) return fromPhone(input.phone);
  return null;
}

/** Recognised but refused: more than one timezone, so no single answer is honest. */
const MULTI_ZONE = new Set([
  'united states', 'usa', 'us', 'united states of america', 'america',
  'canada', 'ca',
  'australia', 'au',
  'brazil', 'br',
  'russia', 'ru', 'russian federation',
  'mexico', 'mx',
  'indonesia', 'id',
  'china', 'cn', // one official zone, but Xinjiang runs on two in practice; leave it to a person
  'kazakhstan', 'kz',
  'argentina', 'ar',
  'chile', 'cl',
]);
