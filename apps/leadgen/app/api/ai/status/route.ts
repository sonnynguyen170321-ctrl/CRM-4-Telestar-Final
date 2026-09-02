import { getEffectiveAiStatus } from "@/lib/server/ai/runtimeSettings";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getEffectiveAiStatus());
}
