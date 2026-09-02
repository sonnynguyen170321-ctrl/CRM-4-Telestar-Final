import { requirePermission } from "@/lib/v2/tenant";
import { queryRuntimeSync } from "@/lib/v2/runtime/queryRuntimeSync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Deep D2: SSE push transport for background-job completion. Holds one long-lived, tenant-scoped
// connection and pushes a `sync` event the moment the runtime clock advances — near-instant toasts
// over a single connection instead of the client re-polling. The client (GlobalJobWatcher) opens this
// only from the single-flight leader tab and falls back to /v2/api/runtime/sync on any error, so this
// is strictly additive. The server still polls the DB internally on a tight interval, but only emits
// on change; a heartbeat keeps proxies from idling the connection, and a hard duration cap lets the
// client reconnect cleanly (bounding connection lifetime on the server).

const POLL_MS = 3000;
const HEARTBEAT_MS = 25000;
const MAX_DURATION_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function GET(request: Request) {
  let context;
  try {
    context = await requirePermission("crm.read");
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const organizationId = context.organizationId;

  const { searchParams } = new URL(request.url);
  const sinceParam = searchParams.get("since");
  let lastTs = sinceParam ? parseInt(sinceParam, 10) : 0;
  if (!Number.isFinite(lastTs)) lastTs = 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const startedAt = Date.now();

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const sendSync = (payload: { lastMutationTimestamp: number; completedJobs: unknown[] }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: sync\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          close();
        }
      };

      // The client can abort at any time (tab hidden/closed) — stop the loop promptly.
      request.signal.addEventListener("abort", close);

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: hb\n\n`));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);

      try {
        // Baseline snapshot: establish the clock without replaying pre-existing terminal jobs.
        const initial = await queryRuntimeSync(organizationId, null);
        if (initial.lastMutationTimestamp > lastTs) lastTs = initial.lastMutationTimestamp;
        sendSync({ lastMutationTimestamp: lastTs, completedJobs: [] });

        while (!closed && Date.now() - startedAt < MAX_DURATION_MS) {
          await sleep(POLL_MS);
          if (closed) break;
          const state = await queryRuntimeSync(organizationId, lastTs ? new Date(lastTs) : null);
          if (state.lastMutationTimestamp > lastTs) {
            sendSync({ lastMutationTimestamp: state.lastMutationTimestamp, completedJobs: state.completedJobs });
            lastTs = state.lastMutationTimestamp;
          }
        }
      } catch {
        /* transient DB error → end the stream; client reconnects or falls back to poll */
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
