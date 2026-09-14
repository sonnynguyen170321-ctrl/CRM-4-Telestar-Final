import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hasScope } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/enrich
 * Ingest external intelligence & research for a lead (from Clay, Apollo, Clearbit, ZoomInfo).
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  if (!hasScope(user, 'enrich:write') && !hasScope(user, 'leads:write')) {
    return NextResponse.json(
      { error: 'Forbidden: missing enrich:write or leads:write scope' },
      { status: 403 }
    );
  }

  // Every read and write below runs inside the API key's tenant. The writes were wrapped
  // individually and the reads were not; with a bearer token and no session cookie the Prisma
  // extension then resolved no tenant for the reads and short-circuited them to empty/null, so
  // the list came back blank, dedupe never matched, and calls/enrich 404'd on leads that exist.
  // Wrapping the whole handler once means there is no next read to forget.
  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }
  const tenantId = user.tenantId;
  return tenantStorage.run({ tenantId }, async () => {
    const body = await req.json();
    const {
      leadId,
      email,
      personData,
      researchSummary,
    } = body;

    let lead = null;
    if (leadId) {
      lead = await prisma.lead.findFirst({
        where: { id: leadId, tenantId },
      });
    } else if (email) {
      lead = await prisma.lead.findFirst({
        where: { email: { equals: email.trim(), mode: 'insensitive' }, tenantId },
      });
    }

    if (!lead) {
      return NextResponse.json(
        { error: 'Lead not found in CRM. Provide valid leadId or email.' },
        { status: 404 }
      );
    }

    const updatedLead = await tenantStorage.run({ tenantId }, () =>
      prisma.lead.update({
        where: { id: lead.id },
        data: {
          title: personData?.title || lead.title,
          phone: personData?.phone || lead.phone,
          linkedIn: personData?.linkedinUrl || personData?.linkedIn || lead.linkedIn,
          ...(researchSummary
            ? {
                notes: {
                  // No tenantId: the Note now reaches Lead through a composite key
                  // (leadId, tenantId), so Prisma takes the tenant from the parent and the
                  // nested input no longer accepts one. A note can no longer be attached to a
                  // lead in a different tenant, which is why the field is gone rather than
                  // merely redundant.
                  create: {
                    content: `🔍 [External Research Summary]\n${researchSummary}`,
                    createdById: user.id,
                  },
                },
              }
            : {}),
        },
      })
    );

    return NextResponse.json({
      success: true,
      leadId: updatedLead.id,
      message: 'Lead intelligence updated successfully.',
    });
  });
}
