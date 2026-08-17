import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { canImportExport } from '@/lib/permissions';

export type CrmSurface =
  | 'dashboard'
  | 'leads'
  | 'lead_detail'
  | 'campaigns'
  | 'campaign_detail'
  | 'sequences'
  | 'sequence_detail'
  | 'inbox'
  | 'meetings'
  | 'automation'
  | 'team'
  | 'client_reports'
  | 'leadgen'
  | 'settings'
  | 'admin'
  | 'unknown';

export interface SituationActor {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  isManager: boolean;
  canExport: boolean;
}

export interface SituationEntityContext {
  entityType?: 'lead' | 'campaign' | 'sequence' | 'account' | 'meeting' | 'thread';
  entityId?: string;
  entityName?: string;
  currentStage?: string;
  assignedToName?: string;
  metadata?: Record<string, any>;
}

export interface SituationState {
  actor: SituationActor;
  surface: CrmSurface;
  entity?: SituationEntityContext;
  recentEvents: string[];
  operationalSummary: string;
  uncertainty?: string;
}

export interface ResolveSituationParams {
  actor: {
    id: string;
    email: string;
    name?: string;
    role: Role;
    tenantId: string;
  };
  surface?: string;
  entityType?: string;
  entityId?: string;
  requestText?: string;
}

/**
 * Resolves full page-aware situation context from active user, URL surface, and entity state.
 */
export async function resolveSituation(
  params: ResolveSituationParams
): Promise<SituationState> {
  const { actor, surface = 'dashboard', entityType, entityId } = params;

  const situationActor: SituationActor = {
    id: actor.id,
    email: actor.email,
    name: actor.name || actor.email,
    role: actor.role,
    tenantId: actor.tenantId,
    isManager: ['director', 'floor_manager', 'team_lead'].includes(actor.role),
    canExport: canImportExport(actor.role),
  };

  const normalizedSurface = normalizeSurface(surface);
  let entityContext: SituationEntityContext | undefined;
  const recentEvents: string[] = [];

  // Entity Resolution
  if (entityId && actor.tenantId) {
    if (entityType === 'lead' || normalizedSurface === 'lead_detail') {
      const lead = await prisma.lead.findFirst({
        where: { id: entityId, tenantId: actor.tenantId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          stage: true,
          assignedTo: { select: { firstName: true, lastName: true } },
          activities: {
            take: 3,
            orderBy: { createdAt: 'desc' },
            select: { type: true, description: true, createdAt: true },
          },
        },
      });

      if (lead) {
        entityContext = {
          entityType: 'lead',
          entityId: lead.id,
          entityName: `${lead.firstName} ${lead.lastName} (${lead.company})`.trim(),
          currentStage: lead.stage,
          assignedToName: `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`.trim(),
        };

        for (const act of lead.activities) {
          recentEvents.push(
            `[${act.createdAt.toISOString().slice(11, 16)}] ${act.type}: ${act.description || 'no description'}`
          );
        }
      }
    } else if (entityType === 'campaign' || normalizedSurface === 'campaign_detail') {
      const campaign = await prisma.campaign.findFirst({
        where: { id: entityId, tenantId: actor.tenantId },
        select: {
          id: true,
          name: true,
          status: true,
          _count: { select: { leads: true } },
        },
      });

      if (campaign) {
        entityContext = {
          entityType: 'campaign',
          entityId: campaign.id,
          entityName: campaign.name,
          currentStage: campaign.status,
          metadata: { totalLeads: campaign._count.leads },
        };
      }
    }
  }

  const operationalSummary = `Actor ${situationActor.name} (${situationActor.role}) is viewing ${normalizedSurface}${
    entityContext ? ` on entity ${entityContext.entityName} [Stage: ${entityContext.currentStage}]` : ''
  }.`;

  return {
    actor: situationActor,
    surface: normalizedSurface,
    entity: entityContext,
    recentEvents,
    operationalSummary,
  };
}

function normalizeSurface(surface: string): CrmSurface {
  const s = surface.toLowerCase().replace(/[^a-z_]/g, '');
  const known: CrmSurface[] = [
    'dashboard',
    'leads',
    'lead_detail',
    'campaigns',
    'campaign_detail',
    'sequences',
    'sequence_detail',
    'inbox',
    'meetings',
    'automation',
    'team',
    'client_reports',
    'leadgen',
    'settings',
    'admin',
  ];

  for (const k of known) {
    if (s.includes(k)) return k;
  }
  return 'unknown';
}
