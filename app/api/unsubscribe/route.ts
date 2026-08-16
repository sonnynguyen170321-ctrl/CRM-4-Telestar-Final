import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';

export const dynamic = 'force-dynamic';

async function handleUnsubscribe(token: string, source: 'one_click_header' | 'browser_click') {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return { error: 'Invalid or expired unsubscribe token', status: 400 };
  }

  const { tenantId, email, leadId, campaignId } = payload;

  return tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    // 1. Record suppression entry
    const recipientDomain = email.split('@')[1]?.toLowerCase();
    const existing = await prisma.suppressionEntry.findFirst({
      where: {
        tenantId,
        email: email.toLowerCase(),
        ...(campaignId ? { campaignId } : {}),
      },
    });

    if (!existing) {
      await prisma.suppressionEntry.create({
        data: {
          tenantId,
          email: email.toLowerCase(),
          domain: recipientDomain,
          reason: 'unsubscribe',
          campaignId: campaignId || null,
        },
      });
    }

    // 2. If leadId was provided, update lead status & stop active sequence enrollments
    if (leadId) {
      try {
        await prisma.sequenceEnrollment.updateMany({
          where: {
            tenantId,
            leadId,
            status: 'active',
          },
          data: {
            status: 'unenrolled',
            completedAt: new Date(),
          },
        });
      } catch {
        // Silently proceed if enrollment table update encounters non-blocking race
      }
    }

    // 3. Record audit activity
    try {
      await prisma.activity.create({
        data: {
          tenantId,
          userId: 'system',
          leadId: leadId || null,
          type: 'stage_changed',
          channel: 'email',
          description: `Recipient ${email} unsubscribed via ${source}`,
          metadata: {
            email,
            source,
            campaignId,
          },
        },
      });
    } catch {
      // Activity logging failure should never fail the unsubscribe acknowledgement
    }

    return { success: true, email };
  });
}

/**
 * RFC 8058 One-Click POST handler
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || (await req.text().catch(() => ''));
  const cleanToken = token.replace(/^token=/, '');

  const result = await handleUnsubscribe(cleanToken, 'one_click_header');
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, message: `Successfully unsubscribed ${result.email}` });
}

/**
 * Human-readable browser GET handler
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';

  const result = await handleUnsubscribe(token, 'browser_click');
  if ('error' in result) {
    return new NextResponse(
      `<!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><title>Unsubscribe Error</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8fafc;color:#334155;}</style>
      </head>
      <body><div><h2>Unable to process unsubscribe</h2><p>${result.error}</p></div></body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  return new NextResponse(
    `<!DOCTYPE html>
    <html lang="en">
    <head><meta charset="utf-8"><title>Unsubscribed Successfully</title>
    <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#f8fafc;margin:0;}
    .card{background:#1e293b;padding:2.5rem;border-radius:12px;border:1px solid #334155;max-width:440px;text-align:center;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);}
    h1{font-size:1.5rem;margin-bottom:0.75rem;color:#38bdf8;}
    p{color:#94a3b8;line-height:1.6;font-size:0.95rem;}
    .email{color:#f1f5f9;font-weight:600;word-break:break-all;}
    </style>
    </head>
    <body>
      <div class="card">
        <h1>Unsubscribed</h1>
        <p><span class="email">${result.email}</span> has been removed from this mailing list and will receive no further messages.</p>
      </div>
    </body>
    </html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
