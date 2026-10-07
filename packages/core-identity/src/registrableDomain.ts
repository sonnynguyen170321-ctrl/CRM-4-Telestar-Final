import { getDomain, getPublicSuffix } from "tldts";

/**
 * The domain a company actually registered, from a host or URL: `uksoftware.co.uk`, not `co.uk`.
 *
 * Research used "the last two labels", which is right for `.com` and wrong for every country that
 * registers under a second level — `.co.uk`, `.com.au`, `.co.nz`, `.com.vn`, `.com.sa`. Production
 * stored `co.uk` as a company's domain, folded every UK site in a run into one candidate, and matched
 * names against the stem `co` (2026-10-08). The public-suffix list knows the difference.
 *
 * Private suffixes count (`acme.github.io` is Acme's, not GitHub's). Returns null for anything that
 * is not a registrable name: an IP, `localhost`, a bare suffix, free text.
 */
export function registrableDomain(hostOrUrl: string | null | undefined): string | null {
  const host = hostOf(hostOrUrl);
  if (!host) return null;
  return getDomain(host, { allowPrivateDomains: true }) ?? null;
}

/**
 * A government, military or education body — never a commercial prospect. Read from the public
 * suffix (`gov.ae`, `gov.vn`, `ac.uk`, `edu`, `mil`), so `govtech.com` and `education.com.vn`,
 * which are companies, are not caught.
 */
export function isInstitutionalHost(hostOrUrl: string | null | undefined): boolean {
  const host = hostOf(hostOrUrl);
  if (!host) return false;
  const labels = (getPublicSuffix(host) ?? "").split(".");
  // `.gov`, `.edu`, `.mil` stand alone. `ac` and `go` only mean "academic" and "government" one
  // level down (`ac.uk`, `go.id`); on their own `.ac` is a country domain anyone can buy.
  if (labels.length === 1) return TOP_LEVEL_INSTITUTIONAL.has(labels[0]);
  return SECOND_LEVEL_INSTITUTIONAL.has(labels[0]);
}

const TOP_LEVEL_INSTITUTIONAL = new Set(["gov", "mil", "edu"]);
const SECOND_LEVEL_INSTITUTIONAL = new Set(["gov", "gob", "gouv", "govt", "go", "mil", "edu", "ac"]);

function hostOf(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  const withoutScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutScheme.split(/[/?#:]/)[0].replace(/^www\./, "");
  return host.includes(".") ? host : null;
}
