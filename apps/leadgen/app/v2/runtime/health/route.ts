import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { isBullEnabled } from "@/lib/v2/bullmq/config";
import { queryWorkerHealth } from "@/lib/v2/jobs/queryWorkerHealth";

// Secret-gated runtime health: DB reachability, Redis reachability (or "disabled" when
// BullMQ is off — the normal local state), BullMQ enable flag, and worker liveness +
// job backlog. Lets ops see at a glance whether the runtime can actually execute work.
// Never exposed without V2_WORKER_SECRET.

export async function GET(request: NextRequest) {
  const expected = process.env.V2_WORKER_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Runtime health disabled (V2_WORKER_SECRET not set)." }, { status: 503 });
  }
  const provided = request.headers.get("x-v2-worker-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let db: "ok" | "fail" = "ok";
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    db = "fail";
  }

  let redis: "ok" | "disabled" | "fail" = "disabled";
  if (isBullEnabled()) {
    const { pingRedis } = await import("@/lib/v2/bullmq/health");
    redis = await pingRedis();
  }

  const worker = await queryWorkerHealth();

  const ok = db === "ok" && redis !== "fail";
  return NextResponse.json({ ok, db, redis, bullEnabled: isBullEnabled(), worker });
}
