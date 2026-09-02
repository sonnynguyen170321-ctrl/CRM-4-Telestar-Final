import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// Enrollment detail for the campaign-leads drawer: the enrollment + its message history +
// the lead's outreach activity timeline. Tenant-scoped (Inv 5), soft-delete filtered.

type RouteContext = { params: Promise<{ campaignId: string; enrollmentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenant = await requirePermission("crm.read");
    const { campaignId, enrollmentId } = await context.params;

    const [enrollment] = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        leadAssignmentId: string;
        status: string;
        currentStepOrdinal: number;
        nextStepAt: Date | string | null;
        email: string | null;
        enrolledAt: Date | string;
        contactName: string | null;
        companyName: string | null;
      }>
    >(
      `SELECT e."id", e."leadAssignmentId", e."status"::text AS "status",
              e."currentStepOrdinal", e."nextStepAt", e."recipientEmailSnapshot" AS "email",
              e."createdAt" AS "enrolledAt", ct."fullName" AS "contactName", c."name" AS "companyName"
       FROM "V2SequenceEnrollment" e
       INNER JOIN "V2LeadAssignment" la ON la."id" = e."leadAssignmentId" AND la."organizationId" = e."organizationId"
         AND la."status" = 'ACTIVE' AND la."deletedAt" IS NULL
       LEFT JOIN "V2Contact" ct ON ct."id" = e."contactId" AND ct."organizationId" = e."organizationId"
         AND ct."status" = 'ACTIVE' AND ct."deletedAt" IS NULL
       LEFT JOIN "V2Company" c ON c."id" = la."companyId" AND c."organizationId" = la."organizationId"
         AND c."status" = 'ACTIVE' AND c."deletedAt" IS NULL
       WHERE e."organizationId" = $1 AND e."sequenceId" = $2 AND e."id" = $3 AND e."deletedAt" IS NULL
       LIMIT 1`,
      tenant.organizationId,
      campaignId,
      enrollmentId
    );

    if (!enrollment) {
      return NextResponse.json({ ok: false, error: "Enrollment not found" }, { status: 404 });
    }

    const [messages, activities] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ id: string; status: string; subject: string | null; toAddress: string | null; sentAt: Date | string | null; createdAt: Date | string }>>(
        `SELECT "id", "status"::text AS "status", "subject", "toAddress", "sentAt", "createdAt"
         FROM "V2OutreachMessage"
         WHERE "organizationId" = $1 AND "enrollmentId" = $2 AND "deletedAt" IS NULL
         ORDER BY "createdAt" DESC LIMIT 20`,
        tenant.organizationId,
        enrollmentId
      ),
      prisma.$queryRawUnsafe<Array<{ id: string; eventKind: string; channel: string; occurredAt: Date | string }>>(
        `SELECT "id", "eventKind", "channel", "occurredAt"
         FROM "V2OutreachActivity"
         WHERE "organizationId" = $1 AND "leadAssignmentId" = $2
         ORDER BY "occurredAt" DESC LIMIT 20`,
        tenant.organizationId,
        enrollment.leadAssignmentId
      ),
    ]);

    return NextResponse.json({
      ok: true,
      enrollment: { ...enrollment, nextStepAt: iso(enrollment.nextStepAt), enrolledAt: iso(enrollment.enrolledAt) },
      messages: messages.map((m) => ({ ...m, sentAt: iso(m.sentAt), createdAt: iso(m.createdAt) })),
      activities: activities.map((a) => ({ ...a, occurredAt: iso(a.occurredAt) })),
    });
  } catch (error) {
    if (error instanceof V2TenantError) {
      const unauth = error.code === "UNAUTHENTICATED";
      return NextResponse.json({ ok: false, error: unauth ? "Unauthorized" : "Forbidden" }, { status: unauth ? 401 : 403 });
    }
    console.error("ENROLLMENT_DETAIL_FAILED", error);
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
