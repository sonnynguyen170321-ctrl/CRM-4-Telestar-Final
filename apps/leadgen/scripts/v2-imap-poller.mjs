// OL3 IMAP poller: ingests inbound replies/bounces by POSTing the secret-gated
// /v2/outreach/imap-poll route on an interval. The route connects each active
// sender's IMAP mailbox, fetches UIDs above the high-water mark, parses them, and
// applies them via the OL2 runtime (idempotent). Runs unattended (cron or
// `node scripts/v2-imap-poller.mjs`) so the reply/bounce loop closes without a
// browser open.
//
// Env:
//   V2_WORKER_APP_URL          base URL (falls back to APP_URL/NEXT_PUBLIC_APP_URL/APP_BASE_URL)
//   V2_WORKER_SECRET           shared secret matching the server's V2_WORKER_SECRET
//   V2_IMAP_POLL_INTERVAL_MS   poll interval (default 60000); 0 = run once and exit

const baseUrl = (
  process.env.V2_WORKER_APP_URL ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const secret = process.env.V2_WORKER_SECRET;
const intervalMs = Number(process.env.V2_IMAP_POLL_INTERVAL_MS ?? 60000);

if (!secret) {
  console.error("V2_WORKER_SECRET is required.");
  process.exit(1);
}

async function pollOnce() {
  try {
    const res = await fetch(`${baseUrl}/v2/outreach/imap-poll`, {
      method: "POST",
      headers: { "x-v2-worker-secret": secret },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[v2-imap] poll failed ${res.status}:`, body.error ?? "");
      return;
    }
    const applied = (body.summary ?? []).reduce((n, s) => n + (s.applied ?? 0), 0);
    if (applied > 0) {
      console.log(`[v2-imap] applied ${applied} inbound event(s) across ${body.senders} sender(s)`);
    }
  } catch (error) {
    console.error("[v2-imap] error:", error instanceof Error ? error.message : error);
  }
}

if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
  await pollOnce();
  process.exit(0);
}

console.log(`[v2-imap] polling inbound every ${intervalMs}ms at ${baseUrl}`);
 
while (true) {
  await pollOnce();
  await new Promise((r) => setTimeout(r, intervalMs));
}
