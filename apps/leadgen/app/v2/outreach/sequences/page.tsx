import { redirect } from "next/navigation";

// The legacy sequences authoring surface is retired: campaigns and sequences were two UIs
// over the same V2Sequence table, and the campaign workspace now has full step CRUD
// (delay edit / delete / reorder) plus lifecycle (rename / duplicate / archive / delete).
// The authoring library (lib/v2/outreach/sequences/authorSequence.ts) remains the shared
// mutation layer. One concept, one surface.
export default function LegacySequencesRedirect() {
  redirect("/v2/outreach/campaigns");
}
