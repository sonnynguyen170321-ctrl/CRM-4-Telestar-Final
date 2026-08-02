import { NextRequest, NextResponse } from 'next/server';
import { verifyAndFetchSharedReport } from '@/lib/client-reports/shareLinks';

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const result = await verifyAndFetchSharedReport(token);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to access shared report' }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    let passwordAttempt: string | undefined;
    try {
      const body = await req.json();
      passwordAttempt = body.password;
    } catch {
      // Empty body
    }

    const result = await verifyAndFetchSharedReport(token, passwordAttempt);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to access shared report' }, { status: 400 });
  }
}
