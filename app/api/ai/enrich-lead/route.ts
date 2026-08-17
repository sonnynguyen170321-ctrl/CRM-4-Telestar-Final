import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { generateStructured } from '@/lib/ai/generation';

export const dynamic = 'force-dynamic';

export interface LeadEnrichmentResponse {
  companySummary: string;
  industryFocus: string;
  estimatedTechStack: string[];
  keyPainPoints: string[];
  icebreakers: Array<{
    id: string;
    style: string;
    hook: string;
    rationale: string;
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
    const { leadId, customContext } = await req.json();
    if (!leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
    }

    return await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          campaign: true,
          account: true,
          notes: {
            take: 3,
            orderBy: { createdAt: 'desc' },
          },
          activities: {
            take: 5,
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!lead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      }

      const prospectName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Prospect';
      const company = lead.company || 'Unknown Company';
      const title = lead.title || 'Decision Maker';
      const industry = lead.account?.industry || lead.campaign?.targetVertical || 'Technology / B2B';
      const notesSummary = lead.notes.map((n) => n.content).join('; ') || 'None';

      const systemPrompt = `You are a world-class sales intelligence researcher and copywriter (Clay.com + Gong.io specialist).
Your job is to deeply analyze a prospect's company and generate 3 hyper-personalized, non-generic cold email opening hooks (icebreakers).

Rules for Icebreakers:
- Keep each hook under 35 words.
- Sound natural and peer-to-peer, not like a marketing brochure.
- NEVER use generic fluff like "Hope this email finds you well" or "I came across your profile".
- Connect directly to their likely business friction or operational bottlenecks.

Output valid JSON matching this schema:
{
  "companySummary": "2-sentence breakdown of what the company does and who they sell to.",
  "industryFocus": "Specific B2B niche.",
  "estimatedTechStack": ["e.g. Salesforce", "Outreach", "Stripe", "PostgreSQL"],
  "keyPainPoints": [
    "Pain 1",
    "Pain 2",
    "Pain 3"
  ],
  "icebreakers": [
    {
      "id": "pain_hypothesis",
      "style": "🔥 Operational Pain Hook",
      "hook": "Specific 1-2 sentence hook calling out a likely friction point for their role.",
      "rationale": "Why this resonates with a ${title}."
    },
    {
      "id": "social_proof",
      "style": "📈 Case Study / ROI Hook",
      "hook": "Specific 1-2 sentence hook citing how similar companies scaled pipeline.",
      "rationale": "Builds fast credibility."
    },
    {
      "id": "industry_trend",
      "style": "🌐 Market Shift Hook",
      "hook": "Specific 1-2 sentence hook about an industry bottleneck affecting their niche.",
      "rationale": "Demonstrates domain expertise."
    }
  ]
}`;

      const userPrompt = `Prospect:
- Name: ${prospectName}
- Title: ${title}
- Company: ${company}
- Industry: ${industry}
- Campaign: ${lead.campaign?.name || 'General Outbound'}
- Notes: ${lead.notes || 'None'}
${customContext ? `- Additional Context: ${customContext}` : ''}

Generate structured prospect research and 3 calibrated icebreakers in JSON now:`;

      const result = await generateStructured<LeadEnrichmentResponse>(
        {
          tenantId,
          userId,
          leadId,
          operation: 'enrich_lead',
          systemPrompt,
          userPrompt,
        },
        (raw: string) => {
          try {
            const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (!parsed.companySummary || !Array.isArray(parsed.icebreakers)) return null;
            return parsed as LeadEnrichmentResponse;
          } catch {
            return null;
          }
        }
      );

      if (!result.available || !result.data) {
        return NextResponse.json({
          success: true,
          data: {
            companySummary: `${company} is an active player in the ${industry} space focusing on high-growth B2B services.`,
            industryFocus: industry,
            estimatedTechStack: ['CRM', 'Email Automation', 'Analytics'],
            keyPainPoints: [
              'Manual SDR prospecting workflows slowing cadence',
              'Sub-optimal cold email deliverability and reply rates',
              'Lack of real-time pipeline visibility across reps',
            ],
            icebreakers: [
              {
                id: 'pain_hypothesis',
                style: '🔥 Operational Pain Hook',
                hook: `Noticed ${company}'s focus on expanding sales velocity—curious how your team is managing SDR inbox deliverability this quarter?`,
                rationale: `Targeted at ${title} scaling outbound without burning domains.`,
              },
              {
                id: 'social_proof',
                style: '📈 Case Study / ROI Hook',
                hook: `We recently helped a B2B team in ${industry} double their qualified meetings by automating research-grounded outreach.`,
                rationale: `Proof-first hook.`,
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
    console.error('Failed to enrich lead:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
