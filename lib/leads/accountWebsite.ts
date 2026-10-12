import { safeHttpUrl } from '@/lib/security/safeHref';

export type AccountWebsiteSource = {
  website?: string | null;
  domain?: string | null;
  canonicalDomain?: string | null;
} | null | undefined;

/**
 * The company's site for a link: `website`, else `domain`, else `canonicalDomain`, the first one that
 * is a usable http(s) address. `label` is the bare host, for display.
 */
export function accountWebsite(account: AccountWebsiteSource): { href: string; label: string } | null {
  if (!account) return null;
  for (const candidate of [account.website, account.domain, account.canonicalDomain]) {
    const href = safeHttpUrl(candidate);
    if (!href) continue;
    return { href, label: new URL(href).hostname.replace(/^www\./i, '') };
  }
  return null;
}
