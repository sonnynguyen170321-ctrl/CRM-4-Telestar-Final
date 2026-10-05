/**
 * The signature builder: a rep fills in fields, this returns email-safe HTML.
 *
 * Email clients ignore stylesheets and most layout CSS, so the output is tables with inline styles —
 * the same shape as a signature designed in Gmail. It uses only markup `sanitizeSignatureHtml`
 * keeps (tests/email-signature.test.ts holds that), so saving a built signature never changes it.
 * Browser-safe: no Node imports.
 */

export type SignatureLayout = 'logo-left' | 'stacked' | 'minimal';

export type SignatureFields = {
  closing: string;
  shortName: string;
  firstName: string;
  lastName: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  /** An https URL or a data URI from an uploaded file. */
  logoSrc: string;
  accentColor: string;
  nameColor: string;
  layout: SignatureLayout;
};

export const DEFAULT_SIGNATURE_FIELDS: SignatureFields = {
  closing: 'Best regards,',
  shortName: '',
  firstName: '',
  lastName: '',
  title: '',
  phone: '',
  email: '',
  website: '',
  logoSrc: '',
  accentColor: '#1F6FB2',
  nameColor: '#E8833A',
  layout: 'logo-left',
};

const FONT = 'font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222222';
const LINK = 'color:#1155CC;text-decoration:underline';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function color(value: string, fallback: string): string {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value.trim()) ? value.trim() : fallback;
}

function websiteHref(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

function logoImg(src: string, width: number): string {
  if (!/^(?:https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src.trim())) return '';
  return `<img src="${escapeHtml(src.trim())}" alt="Logo" width="${width}" style="display:block;border:0">`;
}

function contactLines(f: SignatureFields): string[] {
  const lines: string[] = [];
  const phone = f.phone.trim();
  const email = f.email.trim();
  if (phone) {
    const dial = phone.replace(/[^\d+]/g, '');
    lines.push(`<b>M:</b> <a href="tel:${escapeHtml(dial)}" style="${LINK}">${escapeHtml(phone)}</a>`);
  }
  if (email) {
    lines.push(`<b>E:</b> <a href="mailto:${escapeHtml(email)}" style="${LINK}">${escapeHtml(email)}</a>`);
  }
  return lines;
}

function websiteLink(site: string): string {
  const trimmed = site.trim();
  if (!trimmed) return '';
  return `<a href="${escapeHtml(websiteHref(trimmed))}" style="color:#222222;text-decoration:none">${escapeHtml(trimmed)}</a>`;
}

function nameHtml(f: SignatureFields, accent: string): string {
  const first = escapeHtml(f.firstName.trim());
  const last = escapeHtml(f.lastName.trim());
  if (!first && !last) return '';
  const nameColor = color(f.nameColor, '#E8833A');
  return `<b style="font-size:15px;color:${nameColor}">${first}</b>${first && last ? ' ' : ''}<b style="font-size:15px;color:${accent}">${last}</b>`;
}

function closingHtml(f: SignatureFields): string {
  const parts = [f.closing.trim(), f.shortName.trim()].filter(Boolean).map(escapeHtml);
  return parts.length ? `<p style="${FONT};margin:0 0 16px 0">${parts.join('<br>')}</p>` : '';
}

function stack(lines: string[]): string {
  return lines.filter(Boolean).map((line) => `<p style="margin:0 0 8px 0">${line}</p>`).join('');
}

function logoLeft(f: SignatureFields, accent: string): string {
  const logo = logoImg(f.logoSrc, 120);
  const site = websiteLink(f.website);
  const title = f.title.trim() ? `<i><b>${escapeHtml(f.title.trim())}</b></i>` : '';
  const left = logo || site
    ? `<td valign="middle" align="center" style="padding:0 16px 0 0">${logo}${site ? `<p style="margin:12px 0 0 0">${site}</p>` : ''}</td>`
    : '';
  const right = `<td valign="middle" style="border-left:3px solid ${accent};padding:0 0 0 16px">${stack([nameHtml(f, accent), title, ...contactLines(f)])}</td>`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="${FONT}"><tbody><tr>${left}${right}</tr></tbody></table>`;
}

function stacked(f: SignatureFields, accent: string): string {
  const title = f.title.trim() ? `<i>${escapeHtml(f.title.trim())}</i>` : '';
  const logo = logoImg(f.logoSrc, 100);
  const body = stack([nameHtml(f, accent), title, ...contactLines(f), websiteLink(f.website)]);
  const bottom = logo ? `<tr><td style="padding:8px 0 0 0;border-top:2px solid ${accent}">${logo}</td></tr>` : '';
  return `<table cellpadding="0" cellspacing="0" border="0" style="${FONT}"><tbody><tr><td>${body}</td></tr>${bottom}</tbody></table>`;
}

function minimal(f: SignatureFields, accent: string): string {
  const name = nameHtml(f, accent);
  const rest = [
    f.title.trim() ? escapeHtml(f.title.trim()) : '',
    ...contactLines(f),
    websiteLink(f.website),
  ].filter(Boolean);
  return `<p style="${FONT};margin:0">${[name, rest.join(' | ')].filter(Boolean).join('<br>')}</p>`;
}

export function buildSignatureHtml(fields: SignatureFields): string {
  const accent = color(fields.accentColor, DEFAULT_SIGNATURE_FIELDS.accentColor);
  const card =
    fields.layout === 'stacked' ? stacked(fields, accent)
    : fields.layout === 'minimal' ? minimal(fields, accent)
    : logoLeft(fields, accent);
  return `${closingHtml(fields)}${card}`;
}
