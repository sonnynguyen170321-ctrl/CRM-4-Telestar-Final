import { prisma } from '@/lib/prisma';
import { SituationState } from './situation-engine';
import { IntentAnalysis } from './intent-engine';

export interface TieredContext {
  p0RequiredFacts: Record<string, any>;
  p1RecentSupportingFacts: string[];
  p2HistoricalContext: Record<string, any>;
  p3OptionalBackground?: string;
  compiledPromptText: string;
}

/**
 * Builds compact, prioritized context tiers adhering strictly to PII minimization.
 */
export async function buildTelestarContext(params: {
  situation: SituationState;
  intentAnalysis: IntentAnalysis;
}): Promise<TieredContext> {
  const { situation, intentAnalysis } = params;
  const tenantId = situation.actor.tenantId;

  const p0RequiredFacts: Record<string, any> = {
    actorRole: situation.actor.role,
    currentSurface: situation.surface,
    intent: intentAnalysis.intent,
    temporalFrame: intentAnalysis.temporalFrame,
  };

  const p1RecentSupportingFacts: string[] = [...situation.recentEvents];
  const p2HistoricalContext: Record<string, any> = {};
  let p3OptionalBackground: string | undefined;

  // Enrich entity if present
  if (situation.entity?.entityId && tenantId) {
    if (situation.entity.entityType === 'lead') {
      const lead = await prisma.lead.findFirst({
        where: { id: situation.entity.entityId, tenantId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          email: true,
          phone: true,
          stage: true,
          crmPriorityScore: true,
          emailInvalid: true,
          lastContactedAt: true,
          campaign: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      if (lead) {
        p0RequiredFacts.lead = {
          id: lead.id,
          name: `${lead.firstName} ${lead.lastName}`.trim(),
          company: lead.company,
          stage: lead.stage,
          priority: lead.crmPriorityScore,
          isSuppressed: lead.emailInvalid,
          assignedTo: `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`.trim(),
          campaign: lead.campaign.name,
        };

        if (lead.lastContactedAt) {
          p1RecentSupportingFacts.push(`Last contacted: ${lead.lastContactedAt.toISOString()}`);
        }
      }
    }
  }

  // Compile into structured Markdown prompt context block
  const lines: string[] = [
    '=== TELESTAR CONTEXT (SOURCE OF TRUTH) ===',
    `[P0 - Core State]: Role=${situation.actor.role} | Surface=${situation.surface} | Intent=${intentAnalysis.intent}`,
  ];

  if (p0RequiredFacts.lead) {
    const l = p0RequiredFacts.lead;
    lines.push(
      `[P0 - Active Lead]: ${l.name} (${l.company}) | Stage: ${l.stage} | Priority: ${l.priority} | Owner: ${l.assignedTo} | Suppressed: ${l.isSuppressed}`
    );
  }

  if (p1RecentSupportingFacts.length > 0) {
    lines.push('[P1 - Recent Events]:');
    for (const evt of p1RecentSupportingFacts) {
      lines.push(`  • ${evt}`);
    }
  }

  lines.push('=== END CONTEXT ===');

  return {
    p0RequiredFacts,
    p1RecentSupportingFacts,
    p2HistoricalContext,
    p3OptionalBackground,
    compiledPromptText: lines.join('\n'),
  };
}
