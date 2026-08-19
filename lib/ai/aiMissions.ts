/**
 * Telestar AI Missions Framework (Directive Phase 16 §67, §68).
 * Goal-directed operational missions with explicit approval policies and action receipts.
 */

export type MissionStatus = 'PROPOSED' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ABORTED';

export interface MissionStep {
  stepNumber: number;
  description: string;
  assignedRole: string;
  requiresApproval: boolean;
  isApproved: boolean;
  isExecuted: boolean;
  executionReceiptId?: string | null;
}

export interface AiMission {
  id: string;
  campaignId: string;
  objective: string;
  baselineMetrics: string;
  targetMetrics: string;
  constraints: string[];
  planSteps: MissionStep[];
  status: MissionStatus;
  proposedBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  progressPercentage: number;
  outcomeSummary?: string | null;
}

export function createAiMission(params: {
  campaignId: string;
  objective: string;
  baselineMetrics: string;
  targetMetrics: string;
  constraints: string[];
  planSteps: Omit<MissionStep, 'isApproved' | 'isExecuted'>[];
}): AiMission {
  return {
    id: `mission_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    campaignId: params.campaignId,
    objective: params.objective,
    baselineMetrics: params.baselineMetrics,
    targetMetrics: params.targetMetrics,
    constraints: params.constraints,
    planSteps: params.planSteps.map((s) => ({
      ...s,
      isApproved: !s.requiresApproval,
      isExecuted: false,
    })),
    status: 'PROPOSED',
    proposedBy: 'Telestar AI Mission Control',
    progressPercentage: 0,
  };
}

export function approveMissionStep(mission: AiMission, stepNumber: number, approvedBy: string): AiMission {
  const step = mission.planSteps.find((s) => s.stepNumber === stepNumber);
  if (step) {
    step.isApproved = true;
  }
  const allApproved = mission.planSteps.every((s) => s.isApproved);
  if (allApproved && mission.status === 'PROPOSED') {
    mission.status = 'APPROVED';
    mission.approvedBy = approvedBy;
    mission.approvedAt = new Date();
  }
  return { ...mission };
}
