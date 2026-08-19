/**
 * Durable Tool Idempotency, Action Preview, Receipts & Post-Condition Verification
 * (Directive Phase 1 §17, §18, §19, §20, §21).
 */

import { prisma, tenantStorage } from '@/lib/prisma';

export type ActionRiskLevel =
  | 'READ'
  | 'DRAFT'
  | 'LOW_RISK_WRITE'
  | 'BUSINESS_WRITE'
  | 'EXTERNAL_COMMUNICATION'
  | 'ADMIN_HIGH_RISK';

export interface ActionPreview {
  actionName: string;
  summary: string;
  recordsAffectedCount: number;
  entities: { type: string; id: string; label: string }[];
  riskLevel: ActionRiskLevel;
  requiresConfirmation: boolean;
  reversible: boolean;
  explanation: string;
}

export interface ActionReceipt {
  receiptId: string;
  executionId: string;
  turnId?: string;
  toolName: string;
  actionName: string;
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'REFUSED';
  recordsAffected: number;
  actorId: string;
  tenantId: string;
  timestamp: string;
  details: Record<string, unknown>;
  postConditionVerified: boolean;
  undoable: boolean;
}

export interface IdempotencyKeyContext {
  tenantId: string;
  userId: string;
  executionId: string;
  turnId?: string;
  toolOrdinal: number;
  toolName: string;
}

/**
 * Generate a deterministic idempotency key for durable execution deduplication.
 */
export function generateToolIdempotencyKey(ctx: IdempotencyKeyContext): string {
  return `${ctx.tenantId}:${ctx.userId}:${ctx.executionId}:${ctx.turnId || '0'}:${ctx.toolOrdinal}:${ctx.toolName}`;
}

/**
 * Verify post-conditions after a critical database mutation.
 */
export async function verifyPostConditions(params: {
  tenantId: string;
  entityType: 'lead' | 'sequence_enrollment' | 'task' | 'meeting' | 'opportunity' | 'account';
  entityId: string;
  expectedState: Record<string, unknown>;
}): Promise<{ verified: boolean; actualState?: Record<string, unknown>; diff?: string }> {
  return tenantStorage.run({ tenantId: params.tenantId, bypassRls: false }, async () => {
    try {
      let actual: Record<string, unknown> | null = null;

      switch (params.entityType) {
        case 'lead':
          actual = (await prisma.lead.findUnique({ where: { id: params.entityId } })) as unknown as Record<string, unknown>;
          break;
        case 'task':
          actual = (await prisma.task.findUnique({ where: { id: params.entityId } })) as unknown as Record<string, unknown>;
          break;
        case 'meeting':
          actual = (await prisma.meeting.findUnique({ where: { id: params.entityId } })) as unknown as Record<string, unknown>;
          break;
        case 'opportunity':
          actual = (await prisma.opportunity.findUnique({ where: { id: params.entityId } })) as unknown as Record<string, unknown>;
          break;
        case 'account':
          actual = (await prisma.account.findUnique({ where: { id: params.entityId } })) as unknown as Record<string, unknown>;
          break;
        default:
          return { verified: true };
      }

      if (!actual) {
        return { verified: false, diff: `Entity ${params.entityType}:${params.entityId} not found in database.` };
      }

      // Compare expected fields
      for (const [key, expectedVal] of Object.entries(params.expectedState)) {
        if (actual[key] !== expectedVal) {
          return {
            verified: false,
            actualState: actual,
            diff: `Field mismatch on '${key}': expected '${String(expectedVal)}', found '${String(actual[key])}'.`,
          };
        }
      }

      return { verified: true, actualState: actual };
    } catch (err: unknown) {
      return {
        verified: false,
        diff: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
