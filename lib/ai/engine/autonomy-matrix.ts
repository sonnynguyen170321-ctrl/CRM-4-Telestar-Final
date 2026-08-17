export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type ActionRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ActionRiskPolicy {
  actionName: string;
  riskLevel: ActionRiskLevel;
  maxAllowedAutonomy: AutonomyLevel;
  requiresConfirmation: boolean;
  requiresPreview: boolean;
  isReversible: boolean;
  allowedRoles: string[];
}

export const ACTION_RISK_REGISTRY: Record<string, ActionRiskPolicy> = {
  searchLeads: {
    actionName: 'searchLeads',
    riskLevel: 'LOW',
    maxAllowedAutonomy: 3,
    requiresConfirmation: false,
    requiresPreview: false,
    isReversible: true,
    allowedRoles: ['director', 'floor_manager', 'team_lead', 'sdr', 'leadgen', 'admin'],
  },
  draftReply: {
    actionName: 'draftReply',
    riskLevel: 'LOW',
    maxAllowedAutonomy: 3,
    requiresConfirmation: false,
    requiresPreview: false,
    isReversible: true,
    allowedRoles: ['director', 'floor_manager', 'team_lead', 'sdr'],
  },
  updateLeadStage: {
    actionName: 'updateLeadStage',
    riskLevel: 'MEDIUM',
    maxAllowedAutonomy: 4,
    requiresConfirmation: true,
    requiresPreview: true,
    isReversible: true,
    allowedRoles: ['director', 'floor_manager', 'team_lead', 'sdr'],
  },
  assignLead: {
    actionName: 'assignLead',
    riskLevel: 'MEDIUM',
    maxAllowedAutonomy: 4,
    requiresConfirmation: true,
    requiresPreview: true,
    isReversible: true,
    allowedRoles: ['director', 'floor_manager', 'team_lead'],
  },
  bulkTransferLeads: {
    actionName: 'bulkTransferLeads',
    riskLevel: 'HIGH',
    maxAllowedAutonomy: 4,
    requiresConfirmation: true,
    requiresPreview: true,
    isReversible: true,
    allowedRoles: ['director', 'floor_manager'],
  },
  deactivateUser: {
    actionName: 'deactivateUser',
    riskLevel: 'CRITICAL',
    maxAllowedAutonomy: 4,
    requiresConfirmation: true,
    requiresPreview: true,
    isReversible: false,
    allowedRoles: ['director', 'admin'],
  },
};

/**
 * 🎯 AUTONOMY & RISK VALIDATOR (Sections 29 & 30)
 */
export function validateActionAutonomy(params: {
  actionName: string;
  userRole: string;
  currentSystemAutonomy?: AutonomyLevel;
}): { allowed: boolean; reason?: string; policy: ActionRiskPolicy } {
  const { actionName, userRole, currentSystemAutonomy = 3 } = params;

  const policy = ACTION_RISK_REGISTRY[actionName];
  if (!policy) {
    return {
      allowed: false,
      reason: `Unknown action '${actionName}' is not registered in Action Risk Registry.`,
      policy: {
        actionName,
        riskLevel: 'CRITICAL',
        maxAllowedAutonomy: 0,
        requiresConfirmation: true,
        requiresPreview: true,
        isReversible: false,
        allowedRoles: [],
      },
    };
  }

  if (!policy.allowedRoles.includes(userRole)) {
    return {
      allowed: false,
      reason: `Role '${userRole}' is not authorized to execute action '${actionName}'.`,
      policy,
    };
  }

  if (currentSystemAutonomy < policy.maxAllowedAutonomy && policy.riskLevel === 'HIGH') {
    return {
      allowed: false,
      reason: `Action '${actionName}' requires manual human confirmation (System Autonomy is Level ${currentSystemAutonomy}).`,
      policy,
    };
  }

  return { allowed: true, policy };
}
