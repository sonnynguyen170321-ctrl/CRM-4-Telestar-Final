// DEPRECATED: superseded by scripts/v2-runtime-worker.mjs (the canonical runner, run
// via `npm run v2:worker` / `npm run v2:runtime`). Its default db backend replicates
// this script verbatim. Kept temporarily for back-compat; remove once v2:runtime is the
// established path everywhere.
//
// O5s background worker (Link D): drains due outreach jobs (EMAIL_SEND,
// SEQUENCE_STEP_EXECUTE) on an interval by POSTing the secret-gated drain route.
// This is the interim driver until a long-running queue worker is deployed; it
// runs unattended (cron or `node scripts/v2-job-worker.mjs`), so sequences advance
// without a browser open (the gap O5 depends on — B11).
//
// Env:
//   V2_WORKER_APP_URL   base URL (falls back to APP_URL/NEXT_PUBLIC_APP_URL/APP_BASE_URL)
//   V2_WORKER_SECRET    shared secret matching the server's V2_WORKER_SECRET
//   V2_WORKER_INTERVAL_MS  poll interval (default 15000); 0 = run once and exit

const baseUrl = (
  process.env.V2_WORKER_APP_URL ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_BASE_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");
const secret = process.env.V2_WORKER_SECRET;
const intervalMs = Number(process.env.V2_WORKER_INTERVAL_MS ?? 15000);

if (!secret) {
  console.error("V2_WORKER_SECRET is required.");
  process.exit(1);
}

async function drainOnce() {
  try {
    const res = await fetch(`${baseUrl}/v2/outreach/drain`, {
      method: "POST",
      headers: { "x-v2-worker-secret": secret },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[v2-worker] drain failed ${res.status}:`, body.error ?? "");
      return;
    }
    if (body.processed > 0) {
      console.log(`[v2-worker] drained ${body.processed} (${body.stoppedReason})`, JSON.stringify(body.summary));
    }
  } catch (error) {
    console.error("[v2-worker] error:", error instanceof Error ? error.message : error);
  }
}

if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
  await drainOnce();
  process.exit(0);
}

console.log(`[v2-worker] draining outreach jobs every ${intervalMs}ms at ${baseUrl}`);
 
while (true) {
  await drainOnce();
  await new Promise((r) => setTimeout(r, intervalMs));
}
