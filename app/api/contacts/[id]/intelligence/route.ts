import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getContactIntelligenceWithExplainability, getContactEvidenceLedger } from '@/lib/contact-intelligence';
import { handleApiError } from '@/lib/api/errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const tenantId = user.tenantId;

  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
  }

  try {
    const [{ intelligence, explainability }, evidenceLedger] = await Promise.all([
      getContactIntelligenceWithExplainability(id, tenantId),
      getContactEvidenceLedger(id, tenantId),
    ]);

    if (!intelligence) {
      return NextResponse.json({ error: 'Contact intelligence not found' }, { status: 404 });
    }

    return NextResponse.json({
      intelligence,
      explainability,
      evidence: evidenceLedger,
    });
  } catch (err) {
    return handleApiError('api/contacts/[id]/intelligence GET', err);
  }
}
