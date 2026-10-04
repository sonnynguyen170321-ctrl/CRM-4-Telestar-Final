import { NextRequest, NextResponse } from 'next/server';
import { canAccessLeadId, requireAuth, type SessionUser } from '@/lib/auth';
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
    // Tenant scoping alone let any rep read another rep's lead here (pre-launch audit, 2026-10-05).
    if (!(await canAccessLeadId(sessionUser, leadId))) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Scoped, not bypassed. This route reads one lead belonging to the caller's own
    // tenant and does nothing cross-tenant, so it never needed `bypassRls: true` — and
    // that flag switched OFF the extension's automatic `where: { tenantId }`, which is
    // the whole of the tenant boundary on a database with no RLS policies. `leadId`
    // arrives in the request body, so the result was any tenant's lead (TEL-P0-013).
    //
    // Scoping also keeps the route working if DB-level RLS is ever enabled: the bypass
    // path sets `app.bypass_rls` but never `app.current_tenant_id`, and the `crm_app`
    // policy matches on that alone — so under RLS a bypassed read returns nothing at
    // all, including to the tenant that owns the row.
    return await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
      // The explicit filter stays as well. The extension injects the same predicate, and
      // two independent reasons for this lookup to be tenant-correct is the point.
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, tenantId },
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
- Notes: ${notesSummary}
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
        // Say nothing rather than invent something.
        //
        // This used to answer `success: true` with a fabricated payload: a fixed tech stack of
        // CRM / Email Automation / Analytics, three generic pain points, and an icebreaker
        // asserting "We recently helped a B2B team in ${industry} double their qualified
        // meetings by automating research-grounded outreach". Nothing marked any of it as
        // invented, so the research panel rendered it exactly like real findings — and an SDR
        // would paste that sentence, about a customer we never had and a result we never
        // produced, into a cold email to a real prospect.
        //
        // `lib/research/leadRefinement.ts` is the standard already set in this codebase: it
        // returns `degraded: true` with a reason, refines nothing, and drops any rationale
        // citing evidence it was not given. An empty panel is a true statement. A full one that
        // is made up is not, and the operator is the one who pays for the difference.
        return NextResponse.json(
          {
            success: false,
            available: false,
            reason: 'no_research_provider',
            message:
              'Research did not run — no provider was available. Nothing was generated, so ' +
              'nothing shown here is a guess.',
          },
          { status: 503 }
        );
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
