import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

// Pure extractors: pull public emails + phones out of a company page's raw HTML. No network here
// (the caller fetches the HTML) so this stays offline-testable. Emails prefer the company's own
// domain and drop obvious junk (asset filenames, placeholders, noreply). Phones are validated +
// E.164-normalized via libphonenumber-js.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAILTO_RE = /mailto:([^"'?>\s]+)/gi;
const TEL_RE = /tel:([+0-9().\s-]{6,})/gi;
const PHONE_RE = /\+?\d[\d().\s-]{6,}\d/g;

const JUNK_LOCALPARTS = new Set(["noreply", "no-reply", "donotreply", "example", "email", "your", "name", "user", "sentry"]);
const JUNK_DOMAINS = new Set(["example.com", "email.com", "domain.com", "yourdomain.com", "sentry.io", "wix.com", "wixpress.com", "godaddy.com", "sentry-next.wixpress.com"]);
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?)$/i;

function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

function cleanEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase().replace(/[.,;:)]+$/, "");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  if (ASSET_EXT.test(email)) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  if (JUNK_LOCALPARTS.has(local)) return null;
  if (JUNK_DOMAINS.has(domain) || JUNK_DOMAINS.has(rootDomain(domain))) return null;
  if (/\d{6,}/.test(local)) return null; // hashed/asset-ish local parts
  return email;
}

/** Emails found in the HTML, same-company-domain first, deduped, junk removed. */
export function extractEmails(html: string, companyDomain: string): string[] {
  const root = rootDomain(companyDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]);
  const found = new Set<string>();
  for (const m of html.matchAll(MAILTO_RE)) {
    const e = cleanEmail(decodeURIComponent(m[1]));
    if (e) found.add(e);
  }
  for (const m of html.matchAll(EMAIL_RE)) {
    const e = cleanEmail(m[0]);
    if (e) found.add(e);
  }
  const all = Array.from(found);
  const sameDomain = all.filter((e) => rootDomain(e.split("@")[1]) === root);
  const rest = all.filter((e) => rootDomain(e.split("@")[1]) !== root);
  return [...sameDomain, ...rest];
}

/** Valid, E.164-normalized phone numbers from the HTML (tel: links preferred). */
export function extractPhones(html: string, defaultCountry?: CountryCode): string[] {
  const candidates: string[] = [];
  for (const m of html.matchAll(TEL_RE)) candidates.push(m[1]);
  for (const m of html.matchAll(PHONE_RE)) candidates.push(m[0]);
  const out = new Set<string>();
  for (const raw of candidates) {
    const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    if (parsed && parsed.isValid()) out.add(parsed.number); // E.164
    if (out.size >= 5) break;
  }
  return Array.from(out);
}

/** Pick the best email for a person: same-domain personal (name-matching) > same-domain > any. */
export function pickBestEmail(emails: string[], fullName: string, companyDomain: string): string | null {
  if (emails.length === 0) return null;
  const root = rootDomain(companyDomain.toLowerCase().replace(/^www\./, ""));
  const tokens = fullName.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const sameDomain = emails.filter((e) => rootDomain(e.split("@")[1]) === root);
  const personal = sameDomain.find((e) => tokens.some((t) => e.split("@")[0].includes(t)));
  return personal ?? sameDomain[0] ?? emails[0];
}
