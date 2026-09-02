// CTD: rewrite an outbound email body for open + click tracking. Only called
// when the sender has a VERIFIED tracking domain (no fake metrics otherwise).
// Click links are wrapped through /track/c/<token>; the {token,targetUrl} pairs
// are returned for the caller to persist (V2OutreachTrackingLink) — the runtime
// never trusts a target from the request. An open pixel is appended.

const HTTP_LINK = /https?:\/\/[^\s"'<>)]+/g;

export type RewrittenLink = { token: string; targetUrl: string };
export type RewriteResult = { body: string; links: RewrittenLink[] };

export function rewriteBodyForTracking(input: {
  body: string;
  baseUrl: string;
  openToken: string;
  generateClickToken: () => string;
}): RewriteResult {
  const base = input.baseUrl.replace(/\/+$/, "");
  const links: RewrittenLink[] = [];

  const rewritten = input.body.replace(HTTP_LINK, (url) => {
    // Never rewrite our own tracking links (idempotent if re-run).
    if (url.includes("/v2/outreach/track/")) return url;
    const token = input.generateClickToken();
    links.push({ token, targetUrl: url });
    return `${base}/v2/outreach/track/c/${token}`;
  });

  const pixel = `<img src="${base}/v2/outreach/track/o/${input.openToken}" width="1" height="1" alt="" style="display:none" />`;
  return { body: `${rewritten}\n${pixel}`, links };
}
