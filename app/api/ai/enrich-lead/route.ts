import { NextRequest, NextResponse } from 'next/server';
import { canAccessLeadId, requireAuth, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { generateStructured } from '@/lib/ai/generation';

export const dynamic = 'force-dynamic';

export interface LeadEnrichmentResponse {
  companySummary: string;
  industryFocus: string;
  /** Always empty: no longer generated (it was invented). Kept so older clients do not break. */
  estimatedTechStack: string[];
  grounding?: { usedResearch: boolean; researchedFacts: number; hasTitle: boolean; hasNotes: boolean };
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
      const company = lead.company || 'Unknown company';
      const title = lead.title || null;
      const notesSummary = lead.notes.map((n) => n.content.slice(0, 400)).join('; ');

      // What the CRM actually knows about the company, from its research run. Without it the
      // model was asked for a tech stack and a "how similar companies scaled pipeline" hook about
      // a company it knew nothing of — and wrote both anyway (AI review, 2026-10-06).
      const research = lead.accountId
        ? await prisma.companyIntelligenceProfile.findFirst({
            where: { tenantId, accountId: lead.accountId, profileStatus: { in: ['extracted', 'partial'] } },
            orderBy: { createdAt: 'desc' },
            select: { companySummary: true, industryCategory: true, factsJson: true },
          })
        : null;
      const facts = Array.isArray(research?.factsJson)
        ? (research!.factsJson as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 12).map((f) => f.replace(/_/g, ' '))
        : [];

      const known: string[] = [
        `Name: ${prospectName}`,
        `Company: ${company}`,
        title ? `Title: ${title}` : 'Title: unknown',
        lead.account?.industry ? `Industry (from the CRM): ${lead.account.industry}` : null,
        lead.account?.country ? `Country: ${lead.account.country}` : null,
        lead.account?.size ? `Employees: ${lead.account.size}` : null,
        lead.account?.website ? `Website: ${lead.account.website}` : null,
        research?.companySummary ? `What the company does (from our research): ${research.companySummary.slice(0, 800)}` : null,
        research?.industryCategory ? `Category (from our research): ${research.industryCategory}` : null,
        facts.length ? `Researched facts: ${facts.join('; ')}` : null,
        lead.campaign?.name ? `Our campaign: ${lead.campaign.name}${lead.campaign.targetVertical ? ` (targeting ${lead.campaign.targetVertical})` : ''}` : null,
        notesSummary ? `Rep notes: ${notesSummary}` : null,
      ].filter((line): line is string => Boolean(line));

      const systemPrompt = `You help a B2B SDR prepare a first cold email. You are given everything the CRM knows about one prospect.

Hard rules — breaking any of them makes the output unusable:
- Use ONLY the facts provided. Never invent customers, case studies, results, numbers, funding, news, tools or technology the company uses.
- When you reason beyond the facts, say so plainly ("likely", "teams like yours often") and keep it general to the role, never a specific claim about this company.
- If the facts are thin, say so in companySummary ("We have little on this company: …") instead of filling the gap.
- Each hook is under 35 words, peer-to-peer, no "Hope this finds you well", no "I came across your profile".
- Write in English unless the rep notes ask for another language.

Output valid JSON exactly in this schema:
{
  "companySummary": "1-2 sentences, only from the facts given.",
  "industryFocus": "Their niche, or \"unknown\".",
  "keyPainPoints": ["2-3 likely frictions for someone in this role, each phrased as likely, not as fact"],
  "icebreakers": [
    { "id": "role_friction", "style": "Role friction", "hook": "...", "rationale": "Which fact or role it is based on." },
    { "id": "fact_reference", "style": "Something we know about them", "hook": "A hook built on one researched fact. If there is no researched fact, a hook about their stated role instead.", "rationale": "The fact used." },
    { "id": "question", "style": "Sharp question", "hook": "One specific, low-pressure question about their priorities.", "rationale": "Why this question fits." }
  ]
}`;

      const knownBlock = known.map((line) => `- ${line}`).join('\n');
      const repAsk = customContext ? `\nThe rep asks: ${String(customContext).slice(0, 500)}` : '';
      const userPrompt = `What the CRM knows:\n${knownBlock}\n${repAsk}\n\nReturn the JSON now.`;

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
        data: {
          ...result.data,
          // The tech-stack guess is no longer asked for; never pass one through.
          estimatedTechStack: [],
          // What the hooks were built from, so the rep can judge them.
          grounding: { usedResearch: Boolean(research), researchedFacts: facts.length, hasTitle: Boolean(title), hasNotes: Boolean(notesSummary) },
        },
      });
    });
  } catch (error: unknown) {
    console.error('Failed to enrich lead:', error);
    return NextResponse.json({ error: 'Could not generate research for this lead' }, { status: 500 });
  }
}
