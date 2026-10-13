import { NextRequest, NextResponse } from 'next/server';
import { consumeAttempt } from '@/lib/security/attemptLimit';
import { canAccessLead, requireAuth, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { generateStructured } from '@/lib/ai/generation';
import {
  buildInstructionBlock,
  generateVariablesRequestSchema,
  parseVariablesOutput,
  saveVariablesRequestSchema,
  VARIABLES_SYSTEM_PROMPT,
} from '@/lib/ai/leadVariables';
import { loadAiVariables, saveAiVariables } from '@/lib/leads/aiVariablesStore';
import { loadLeadInsight } from '@/lib/leads/aiInsightStore';
import type { AiVariables } from '@/lib/leads/aiVariablesShape';

export const dynamic = 'force-dynamic';

/**
 * The AI merge variables ({{ai.icebreaker}} ...) for one lead.
 *
 *  GET   the saved set, so the composer shows it again.
 *  POST  generate from what the CRM already knows (company research, saved hooks, the lead's own
 *        fields) and save it. With no research there is nothing true to say, so nothing is
 *        generated: no provider is called and the variables stay empty (the composer shows the
 *        fallback and a warning).
 *  PUT   the rep's edit of the saved values, before sending.
 *
 * Same boundary as app/api/ai/enrich-lead: tenant from the session, canAccessLeadId on the lead,
 * a per-rep limit, and the rep's instruction fenced.
 */
const LIMIT_BUCKET = 'ai_lead_variables';
const LIMIT_PER_WINDOW = 120;
const LIMIT_WINDOW_SECONDS = 10 * 60;

async function authorize(leadId: string | null): Promise<{ user: SessionUser; tenantId: string } | NextResponse> {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
  // The lead, read inside the caller's tenant, then the same per-record check the lead drawer uses.
  const tenantId = user.tenantId;
  const lead = await tenantStorage.run({ tenantId, bypassRls: false }, () =>
    prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { assignedToId: true, campaignId: true } }),
  );
  if (!lead || !(await canAccessLead(user, lead))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  return { user, tenantId };
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req.nextUrl.searchParams.get('leadId'));
  if (auth instanceof NextResponse) return auth;
  try {
    const saved = await loadAiVariables(auth.tenantId, req.nextUrl.searchParams.get('leadId')!);
    return NextResponse.json({ success: true, values: saved?.values ?? {}, generatedAt: saved?.generatedAt ?? null });
  } catch (error: unknown) {
    console.error('Failed to load AI variables:', error);
    return NextResponse.json({ error: 'Could not load the AI variables for this lead' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const parsed = saveVariablesRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  const auth = await authorize(parsed.data.leadId);
  if (auth instanceof NextResponse) return auth;
  try {
    const values = await saveAiVariables({
      tenantId: auth.tenantId,
      leadId: parsed.data.leadId,
      userId: auth.user.id,
      values: parsed.data.values as AiVariables,
    });
    return NextResponse.json({ success: true, values });
  } catch (error: unknown) {
    console.error('Failed to save AI variables:', error);
    return NextResponse.json({ error: 'Could not save the AI variables' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const parsed = generateVariablesRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  const { leadId, instruction } = parsed.data;
  const auth = await authorize(leadId);
  if (auth instanceof NextResponse) return auth;
  const { user, tenantId } = auth;

  const attempt = await consumeAttempt({
    bucket: LIMIT_BUCKET,
    subject: user.id,
    limit: LIMIT_PER_WINDOW,
    windowSeconds: LIMIT_WINDOW_SECONDS,
  });
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: 'Too many AI generations in a short time. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSeconds) } },
    );
  }

  try {
    return await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, tenantId },
        include: { campaign: true, account: true, notes: { take: 3, orderBy: { createdAt: 'desc' } } },
      });
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

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
      const savedHooks = (await loadLeadInsight(tenantId, leadId))?.hooks?.data ?? null;

      // No research and no saved research panel: the lead's name, title and company are all we have, and
      // an icebreaker built from those alone is exactly the invented line we refuse to write.
      const grounded = Boolean(research?.companySummary) || facts.length > 0 || Boolean(savedHooks);
      if (!grounded) {
        return NextResponse.json(
          {
            success: false,
            reason: 'no_research',
            message:
              'There is no company research for this lead yet, so nothing was generated. Run company research ' +
              'or the AI research panel first; until then the AI variables stay empty and use their fallback.',
          },
          { status: 422 },
        );
      }

      const prospectName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Prospect';
      const known: string[] = [
        `Name: ${prospectName}`,
        `Company: ${lead.company || 'Unknown company'}`,
        lead.title ? `Title: ${lead.title}` : 'Title: unknown',
        lead.account?.industry ? `Industry (from the CRM): ${lead.account.industry}` : null,
        lead.account?.country ? `Country: ${lead.account.country}` : null,
        lead.account?.website ? `Website: ${lead.account.website}` : null,
        research?.companySummary ? `What the company does (from our research): ${research.companySummary.slice(0, 800)}` : null,
        research?.industryCategory ? `Category (from our research): ${research.industryCategory}` : null,
        facts.length ? `Researched facts: ${facts.join('; ')}` : null,
        savedHooks?.companySummary ? `Earlier research summary: ${savedHooks.companySummary.slice(0, 600)}` : null,
        savedHooks?.keyPainPoints?.length ? `Earlier likely pain points: ${savedHooks.keyPainPoints.slice(0, 3).join('; ')}` : null,
        lead.campaign?.name
          ? `Our campaign: ${lead.campaign.name}${lead.campaign.targetVertical ? ` (targeting ${lead.campaign.targetVertical})` : ''}`
          : null,
        lead.notes.length ? `Rep notes: ${lead.notes.map((n) => n.content.slice(0, 300)).join('; ')}` : null,
      ].filter((line): line is string => Boolean(line));

      const userPrompt = `What the CRM knows:\n${known.map((l) => `- ${l}`).join('\n')}\n${buildInstructionBlock(instruction)}\n\nReturn the JSON now.`;
      const result = await generateStructured<AiVariables>(
        { tenantId, userId: user.id, leadId, operation: 'lead_ai_variables', systemPrompt: VARIABLES_SYSTEM_PROMPT, userPrompt },
        parseVariablesOutput,
      );

      if (!result.available) {
        return NextResponse.json(
          { success: false, available: false, reason: 'no_research_provider', message: 'No AI provider was available. Nothing was generated.' },
          { status: 503 },
        );
      }
      if (!result.data) {
        // The model had nothing it could ground, or answered unusably. Say nothing rather than fill the gap.
        return NextResponse.json(
          { success: false, reason: 'nothing_grounded', message: 'The research did not support any personalised line, so nothing was generated.' },
          { status: 422 },
        );
      }

      const values = await saveAiVariables({ tenantId, leadId, userId: user.id, values: result.data });
      return NextResponse.json({ success: true, values, generatedAt: new Date().toISOString() });
    });
  } catch (error: unknown) {
    console.error('Failed to generate AI variables:', error);
    return NextResponse.json({ error: 'Could not generate AI variables for this lead' }, { status: 500 });
  }
}
