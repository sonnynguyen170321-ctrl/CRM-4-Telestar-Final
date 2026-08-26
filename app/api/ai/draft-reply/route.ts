import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { generateStructured } from '@/lib/ai/generation';

export const dynamic = 'force-dynamic';

export interface DraftReplyResponse {
  intent: string;
  intentLabel: string;
  confidence: number;
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'out_of_office';
  drafts: Array<{
    id: string;
    title: string;
    strategy: string;
    subject: string;
    body: string;
  }>;
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const sessionUser = userOrRes as SessionUser;

  if (!sessionUser.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const tenantId = sessionUser.tenantId;
  const userId = sessionUser.id;

  try {
    const body = await req.json();
    const { threadId: _threadId, leadId, messageText, subject, customInstructions } = body;

    // Scoped, not bypassed — see enrich-lead for the full reasoning. This route reads one
    // lead belonging to the caller's own tenant and does nothing cross-tenant, so
    // `bypassRls: true` bought nothing and cost the automatic `where: { tenantId }` that
    // is the entire tenant boundary here (TEL-P0-013). It also keeps the route working
    // if DB-level RLS is enabled, where a bypassed read returns nothing to anybody.
    return await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
      // 1. Resolve lead and conversation context
      let leadInfo: any = null;
      const threadHistory: Array<{ role: string; content: string }> = [];
      let lastInboundMessage = messageText || '';
      let emailSubject = subject || 'Re: Following up';

      if (leadId) {
        // `bypassRls: true` switches OFF the extension's automatic `where: { tenantId }`,
        // and the database carries no RLS policies, so this lookup is the whole of the
        // tenant boundary. `leadId` arrives in the request body: without the explicit
        // filter, any authenticated user could name another tenant's lead and receive it
        // along with five inbound and five outbound messages — real prospect email
        // bodies — which are then sent to an AI provider (TEL-P0-013).
        leadInfo = await prisma.lead.findFirst({
          where: { id: leadId, tenantId },
          include: {
            account: true,
            inboundMessages: { take: 5, orderBy: { date: 'desc' } },
            outboundMessages: { take: 5, orderBy: { createdAt: 'desc' } },
          },
        });

        if (leadInfo?.inboundMessages && leadInfo.inboundMessages.length > 0) {
          const latest = leadInfo.inboundMessages[0];
          lastInboundMessage = latest.body || latest.bodyHtml?.replace(/<[^>]*>?/gm, '') || lastInboundMessage;
          emailSubject = latest.subject || emailSubject;
        }
      }

      if (!leadInfo && leadId) {
        // Same boundary as above: the fallback lookup must be scoped too, or it becomes
        // the bypass the first one no longer is.
        leadInfo = await prisma.lead.findFirst({
          where: { id: leadId, tenantId },
        });
      }

      const prospectName = leadInfo ? `${leadInfo.firstName || ''} ${leadInfo.lastName || ''}`.trim() : 'Prospect';
      const companyName = leadInfo?.company || 'their company';
      const prospectTitle = leadInfo?.title || 'Decision Maker';

      // 2. Generate structured intent and response options
      const systemPrompt = `You are an elite B2B Sales Development Representative (SDR) and email strategist at Telestar.
Your job is to analyze inbound email replies from prospects, accurately classify their intent, and generate 3 high-converting response options.

Follow these cold email reply best practices:
- Keep responses short (under 90 words), conversational, and easy to read on mobile.
- Never be defensive or pushy.
- Acknowledge their perspective directly.
- Include a specific, low-friction Call-to-Action (CTA).
- Format responses as valid JSON matching the exact schema requested.

JSON Output Schema:
{
  "intent": "INTERESTED_DEMO" | "MEETING_REQUEST" | "OBJECTION_PRICING" | "OBJECTION_TIMING" | "OBJECTION_COMPETITOR" | "OUT_OF_OFFICE" | "UNSUBSCRIBE" | "GENERAL_INQUIRY",
  "intentLabel": "Short human-readable label with emoji (e.g. '🎯 Demo Request', '💡 Pricing Objection', '⏰ Timing Objection', '🏖️ Out of Office')",
  "confidence": number between 0.0 and 1.0,
  "summary": "1-sentence summary of what the prospect is saying/asking.",
  "sentiment": "positive" | "neutral" | "negative" | "out_of_office",
  "drafts": [
    {
      "id": "pitch_meeting",
      "title": "🚀 Direct Calendar / Demo Pitch",
      "strategy": "Propose a quick 15-min discovery call or calendar link to address their need.",
      "subject": "string",
      "body": "string"
    },
    {
      "id": "objection_handler",
      "title": "🛡️ Value & ROI Reframe",
      "strategy": "Acknowledge objection and provide concise proof or perspective to lower friction.",
      "subject": "string",
      "body": "string"
    },
    {
      "id": "nurture_clarification",
      "title": "🤝 Open Nurture Question",
      "strategy": "Ask a single diagnostic question to explore their current priority.",
      "subject": "string",
      "body": "string"
    }
  ]
}`;

      const userPrompt = `Prospect Information:
- Name: ${prospectName}
- Company: ${companyName}
- Title: ${prospectTitle}
- Subject: ${emailSubject}

Recent Inbound Message:
"""
${lastInboundMessage || '(No message body provided, generate generic outreach follow-ups)'}
"""

Thread History:
${threadHistory.length > 0 ? threadHistory.map((t) => `${t.role}: ${t.content}`).join('\n---\n') : 'No previous history.'}

${customInstructions ? `Special Instructions from SDR:\n${customInstructions}` : ''}

Analyze the intent and generate the 3 calibrated response options in valid JSON now:`;

      const result = await generateStructured<DraftReplyResponse>(
        {
          tenantId,
          userId,
          leadId: leadInfo?.id || null,
          operation: 'draft_reply',
          systemPrompt,
          userPrompt,
        },
        (raw: string) => {
          try {
            // Clean markdown code blocks if any
            const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (!parsed.intent || !Array.isArray(parsed.drafts)) return null;
            return parsed as DraftReplyResponse;
          } catch {
            return null;
          }
        }
      );

      if (!result.available || !result.data) {
        // Fallback default draft if AI providers unavailable
        return NextResponse.json({
          success: true,
          data: {
            intent: 'GENERAL_INQUIRY',
            intentLabel: '💬 General Inquiry',
            confidence: 0.8,
            summary: 'Prospect replied to outreach.',
            sentiment: 'neutral',
            drafts: [
              {
                id: 'pitch_meeting',
                title: '🚀 Quick Touchpoint',
                strategy: 'Propose a quick 10-minute check-in.',
                subject: `Re: ${emailSubject.replace(/^Re:\s*/i, '')}`,
                body: `Hi ${leadInfo?.firstName || 'there'},\n\nThanks for getting back to me! Would you be open to a quick 10-minute chat this Thursday afternoon to see if Telestar could be a fit for ${companyName}?\n\nBest,\nSonny`,
              },
              {
                id: 'nurture_clarification',
                title: '🤝 Quick Question',
                strategy: 'Clarify current priority.',
                subject: `Re: ${emailSubject.replace(/^Re:\s*/i, '')}`,
                body: `Hi ${leadInfo?.firstName || 'there'},\n\nAppreciate your note. What is your team's main priority around outbound prospecting this quarter?\n\nBest,\nSonny`,
              },
            ],
          },
        });
      }

      return NextResponse.json({
        success: true,
        data: result.data,
      });
    });
  } catch (error: any) {
    console.error('Failed to generate draft reply:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
