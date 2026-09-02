import { NextResponse, type NextRequest } from "next/server";

import { requirePermission } from "@/lib/v2/tenant";
import { MAX_ATTACHMENT_BYTES, putAttachment } from "@/lib/v2/outreach/attachments/storage";

export const dynamic = "force-dynamic";

// Attachment upload endpoint used by RichComposeEditor. Tenant-scoped (session, Invariant 5),
// stores bytes via the storage seam (DB blob default) and returns a storageRef the compose form
// submits back with the send. Never trusts a client organizationId.
export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requirePermission("workflow.update");
  } catch {
    return NextResponse.json({ error: "You cannot upload attachments." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "File is too large (max 10 MB)." }, { status: 413 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await putAttachment({
      organizationId: ctx.organizationId,
      createdByUserId: ctx.userId,
      filename: file.name,
      mimeType: file.type,
      bytes,
    });
    return NextResponse.json({
      storageRef: stored.id,
      id: stored.id,
      filename: stored.filename,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed." }, { status: 400 });
  }
}
