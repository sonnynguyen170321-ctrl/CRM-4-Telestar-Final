"use client";

import { useEffect, useRef } from "react";
import { notifyV2 } from "@/components/v2/notifications/notificationClient";

// Watches background jobs and toasts on completion. Deep D2 upgrade: PREFERS a Server-Sent Events
// stream (/v2/api/runtime/stream) so completions push to the client near-instantly over ONE
// long-lived connection, and FALLS BACK to the optimized poll (/v2/api/runtime/sync) on any SSE
// error. Both paths keep the same guarantees the poll-only version had:
//   - PAUSE while the tab is hidden (visibilitychange) — the stream is closed, the poll is skipped;
//   - SINGLE-FLIGHT across tabs via a localStorage lease — only the leader opens the stream (or
//     polls). Opening a stream per tab would mean N server-side poll loops, strictly worse than the
//     single-flight poll, so followers instead receive results over a BroadcastChannel;
//   - the poll fallback BACKS OFF when idle (6s → 45s) and snaps back on any change;
//   - SSE reconnection uses exponential backoff so a proxy that strips SSE degrades to polling
//     instead of hot-looping the EventSource.

const BASE_MS = 6000;
const MAX_MS = 45000;
const LEASE_KEY = "v2-jobwatch-lease";
const CHANNEL = "v2-jobwatch";
const SSE_BACKOFF_BASE_MS = 4000;
const SSE_BACKOFF_MAX_MS = 60000;

type SyncMessage = { type: "sync"; ts: number; jobs: JobRow[] };
type JobRow = { id: string; jobType: string; status: string; progressTotal?: number };

function toastJob(job: JobRow) {
  const isSuccess = job.status === "COMPLETED" || job.status === "SUCCEEDED";
  notifyV2({
    id: job.id,
    type: isSuccess ? "research.stage.completed" : "research.stage.failed",
    kind: isSuccess ? "success" : "error",
    title: `Job ${job.status}: ${job.jobType}`,
    description: job.progressTotal ? `Processed ${job.progressTotal} items.` : "Background task finished.",
    href: "/v2/ingestion/jobs",
    actionLabel: "View jobs",
  });
}

export function GlobalJobWatcher() {
  const lastTs = useRef<number | null>(null);
  const seenJobs = useRef<Set<string>>(new Set());

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let interval = BASE_MS;
    let inFlight = false;
    let es: EventSource | null = null;
    let sseFailures = 0;
    let sseBlockedUntil = 0; // while Date.now() < this, don't try SSE (recent failure) — poll instead
    const supportsSSE = typeof EventSource !== "undefined";
    const tabId = Math.random().toString(36).slice(2);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;

    // Apply a sync result from either transport: advance the clock, toast + broadcast any newly
    // terminal jobs. Returns whether the clock advanced (drives poll backoff). Never toasts on the
    // first observation (lastTs null) so pre-existing terminal jobs at load don't replay.
    function applySync(ts: number, jobs: JobRow[]): boolean {
      const changed = lastTs.current !== null && ts > lastTs.current;
      const fresh = changed ? jobs : [];
      for (const job of fresh) {
        if (!seenJobs.current.has(job.id)) {
          seenJobs.current.add(job.id);
          toastJob(job);
        }
      }
      if (fresh.length > 0) channel?.postMessage({ type: "sync", ts, jobs: fresh } satisfies SyncMessage);
      if (lastTs.current === null || ts > lastTs.current) lastTs.current = ts;
      return changed;
    }

    // Followers apply the leader's results: advance lastTs + toast any job they haven't toasted.
    if (channel) {
      channel.onmessage = (event: MessageEvent<SyncMessage>) => {
        const data = event.data;
        if (!data || data.type !== "sync") return;
        if (lastTs.current === null || data.ts > lastTs.current) lastTs.current = data.ts;
        for (const job of data.jobs ?? []) {
          if (!seenJobs.current.has(job.id)) {
            seenJobs.current.add(job.id);
            toastJob(job);
          }
        }
      };
    }

    // localStorage lease → single-flight across tabs. A tab may lead if it holds the lease or the
    // lease is stale (its holder closed/hid). The leader refreshes the lease on every tick.
    function claimLease(): boolean {
      try {
        const raw = localStorage.getItem(LEASE_KEY);
        const now = Date.now();
        if (raw) {
          const lease = JSON.parse(raw) as { id: string; at: number };
          const fresh = now - lease.at < Math.max(interval * 2.5, BASE_MS * 2.5);
          if (fresh && lease.id !== tabId) return false; // another live tab leads
        }
        localStorage.setItem(LEASE_KEY, JSON.stringify({ id: tabId, at: now }));
        return true;
      } catch {
        return true; // no storage → just lead
      }
    }

    function closeStream() {
      if (es) {
        es.close();
        es = null;
      }
    }

    // Open the SSE stream if supported, not blocked by backoff, and not already open. Idempotent.
    function openStream(): boolean {
      if (!supportsSSE || stopped) return false;
      if (es) return true; // already streaming
      if (Date.now() < sseBlockedUntil) return false;
      try {
        const url = lastTs.current ? `/v2/api/runtime/stream?since=${lastTs.current}` : "/v2/api/runtime/stream";
        const source = new EventSource(url);
        es = source;
        source.addEventListener("sync", (ev) => {
          sseFailures = 0; // a healthy connection resets the backoff
          try {
            const body = JSON.parse((ev as MessageEvent).data);
            if (typeof body.lastMutationTimestamp === "number") {
              applySync(body.lastMutationTimestamp, Array.isArray(body.completedJobs) ? body.completedJobs : []);
            }
          } catch {
            /* ignore malformed frame */
          }
        });
        source.onerror = () => {
          // Stream dropped (error, or the server hit its duration cap). Back off SSE and hand the
          // next tick to the poll fallback; SSE is retried once the backoff window elapses.
          if (es !== source) return;
          closeStream();
          sseFailures += 1;
          sseBlockedUntil =
            Date.now() + Math.min(SSE_BACKOFF_BASE_MS * 2 ** (sseFailures - 1), SSE_BACKOFF_MAX_MS);
          interval = BASE_MS;
          schedule(0);
        };
        return true;
      } catch {
        es = null;
        sseFailures += 1;
        sseBlockedUntil = Date.now() + Math.min(SSE_BACKOFF_BASE_MS * 2 ** (sseFailures - 1), SSE_BACKOFF_MAX_MS);
        return false;
      }
    }

    async function tick() {
      if (stopped) return;
      if (document.visibilityState === "hidden") {
        closeStream(); // paused; visibilitychange resumes
        return schedule(interval);
      }
      if (!claimLease()) {
        closeStream(); // not the leader → never hold a stream
        return schedule(interval);
      }
      // Leader: prefer the stream. When it's live it drives updates; we still tick on a steady
      // cadence purely to keep the lease warm (cheap — localStorage only, no fetch).
      if (openStream()) return schedule(BASE_MS);

      // No stream available → poll fallback with backoff.
      if (inFlight) return schedule(interval);
      inFlight = true;
      try {
        const url = lastTs.current ? `/v2/api/runtime/sync?since=${lastTs.current}` : "/v2/api/runtime/sync";
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          if (body.ok && typeof body.lastMutationTimestamp === "number") {
            const changed = applySync(
              body.lastMutationTimestamp,
              Array.isArray(body.completedJobs) ? body.completedJobs : []
            );
            interval = changed ? BASE_MS : Math.min(MAX_MS, Math.round(interval * 1.5));
          }
        }
      } catch {
        /* transient */
      } finally {
        inFlight = false;
      }
      schedule(interval);
    }

    function schedule(ms: number) {
      if (timer) clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    }

    function onVisible() {
      if (document.visibilityState === "visible") {
        interval = BASE_MS;
        schedule(0);
      }
    }
    document.addEventListener("visibilitychange", onVisible);

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      closeStream();
      document.removeEventListener("visibilitychange", onVisible);
      channel?.close();
    };
  }, []);

  return null;
}
