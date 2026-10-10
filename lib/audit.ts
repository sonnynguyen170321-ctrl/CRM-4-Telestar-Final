import { Prisma } from '@prisma/client';
import { tenantStorage } from './tenant-context';

const SENSITIVE_FIELDS = new Set([
  'accessToken',
  'refreshToken',
  'encAccessToken',
  'encRefreshToken',
  'encPassword',
  'password',
]);

/**
 * Models this extension does not audit, and why each one is here.
 *
 * The extension runs on `$allModels`, so before this list every write in the product paid for an
 * audit row — and an `update` or `delete` pays twice, because the diff needs a `findUnique` of the
 * row before the write. That is three sequential round trips for one logical write, each holding a
 * pool connection for the duration.
 *
 * Measured on production 2026-09-28, `AuditLog` held 105,330 rows / 55 MB, and **86,350 of them —
 * 82% — were JobRun**: a queue mirror whose whole purpose is to record job state, audited on every
 * queued→active→completed transition. The workers declare 21 concurrent handlers against a
 * 9-connection pool, so that self-inflicted traffic is what they were contending over.
 *
 * The bar for this list is narrow: the model must be machine bookkeeping whose own row already *is*
 * the record of what happened, so an audit entry adds no fact a human could want. Business records —
 * Lead, Opportunity, User, EmailAccount, Client, Campaign, Template, Sequence and the rest — are
 * still fully audited, and nothing about the diff, redaction or tenant resolution changes for them.
 *
 * `AuditLog` and `Tenant` were already skipped inline (self-reference, and a tenant row has no
 * tenant to file under). They are folded in here so there is one list rather than three copies of
 * the same condition.
 */
const UNAUDITED_MODELS: ReadonlySet<string> = new Set([
  // Writing an audit row about the audit table recurses.
  'AuditLog',
  // A Tenant row has no tenant to file the entry against.
  'Tenant',
  // The BullMQ durable mirror. Its status column is the record of the job; 82% of all audit volume.
  'JobRun',
  // An append-only measurement series. Each row is a sample, never an edit to a prior fact.
  'EmailHealthSnapshot',
]);

const redactSensitiveFields = (value: any): any => {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(redactSensitiveFields);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_FIELDS.has(key) ? '[REDACTED]' : redactSensitiveFields(entry),
    ])
  );
};

export const auditExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          
          if (UNAUDITED_MODELS.has(model)) return result;

          try {
            const userId = (args.data as any).createdById || 
                           (args.data as any).assignedToId || 
                           (args.data as any).userId || 
                           null;
            
            const tenantId = (result as any).tenantId || 
                             (args.data as any).tenantId || 
                             tenantStorage.getStore()?.tenantId;
            if (!tenantId) {
              // Never guess. An audit row filed against a fabricated tenant is worse than a
              // missing one: it is evidence that points at the wrong org.
              console.error(`[auditExtension] No tenant resolved for ${model}; audit row skipped`);
              return result;
            }
            await (client as any).auditLog.create({
              data: {
                userId: userId || null,
                action: `create_${model.toLowerCase()}`,
                tableName: model,
                recordId: (result as any).id || '',
                changedFields: redactSensitiveFields(args.data || {}),
                tenantId,
              },
            });
          } catch (err) {
            console.error('[auditExtension] Failed to write create audit log:', err);
          }

          return result;
        },

        async update({ model, args, query }) {
          if (UNAUDITED_MODELS.has(model)) return query(args);

          let currentData: any = null;
          try {
            currentData = await (client as any)[model].findUnique({ where: args.where });
          } catch (err) {
            console.error('[auditExtension] Failed to fetch pre-update data:', err);
          }

          const result = await query(args);

          try {
            const changedFields: Record<string, { old: any; new: any }> = {};
            const newData = args.data as any;

            if (currentData) {
              for (const key of Object.keys(newData)) {
                const oldValue = currentData[key];
                const newValue = newData[key];

                if (oldValue !== newValue && newValue !== undefined && key !== 'updatedAt') {
                  if (typeof newValue !== 'object' || newValue === null || Array.isArray(newValue)) {
                    /**
                     * Redacted by the field's own name, before the `{ old, new }` wrapper hides it.
                     *
                     * `redactSensitiveFields` decides what to blank from the *keys* it is handed.
                     * Wrapping first meant the keys it saw were `old` and `new`, which are in no
                     * sensitive list, so it recursed into two strings and returned them untouched.
                     * The create and delete hooks pass the row itself, where the keys are the field
                     * names, which is why redaction worked there and only here it did not.
                     *
                     * Measured on production 2026-09-28: 10 `AuditLog` rows held a bcrypt hash
                     * under `password.new` and 5 held `encPassword` / `accessToken` /
                     * `refreshToken` values, while all 37 rows written by the create path correctly
                     * read `[REDACTED]`. Not plaintext credentials — but a hash is an offline
                     * cracking target and an encrypted token is not meant to be copied into a
                     * second table, and `AuditLog` is readable by every floor_manager.
                     */
                    changedFields[key] = SENSITIVE_FIELDS.has(key)
                      ? { old: '[REDACTED]', new: '[REDACTED]' }
                      : redactSensitiveFields({ old: oldValue, new: newValue });
                  }
                }
              }
            }

            if (Object.keys(changedFields).length > 0) {
              const userId = currentData?.assignedToId || 
                             currentData?.userId || 
                             currentData?.createdById || 
                             null;

              const tenantId = currentData?.tenantId || 
                               (result as any).tenantId || 
                               (args.data as any).tenantId || 
                               tenantStorage.getStore()?.tenantId;
              if (!tenantId) {
                // Never guess. An audit row filed against a fabricated tenant is worse than a
                // missing one: it is evidence that points at the wrong org.
                console.error(`[auditExtension] No tenant resolved for ${model}; audit row skipped`);
                return result;
              }
              await (client as any).auditLog.create({
                data: {
                  userId: userId || null,
                  action: `update_${model.toLowerCase()}`,
                  tableName: model,
                  recordId: (result as any).id || (args.where as any).id || '',
                  changedFields,
                  tenantId,
                },
              });
            }
          } catch (err) {
            console.error('[auditExtension] Failed to write update audit log:', err);
          }

          return result;
        },

        async delete({ model, args, query }) {
          if (UNAUDITED_MODELS.has(model)) return query(args);

          let currentData: any = null;
          try {
            currentData = await (client as any)[model].findUnique({ where: args.where });
          } catch (err) {
            console.error('[auditExtension] Failed to fetch pre-delete data:', err);
          }

          const result = await query(args);

          try {
            const userId = currentData?.assignedToId || 
                           currentData?.userId || 
                           currentData?.createdById || 
                           null;
            
            const tenantId = currentData?.tenantId || 
                             tenantStorage.getStore()?.tenantId;
            if (!tenantId) {
              // Never guess. An audit row filed against a fabricated tenant is worse than a
              // missing one: it is evidence that points at the wrong org.
              console.error(`[auditExtension] No tenant resolved for ${model}; audit row skipped`);
              return result;
            }
            await (client as any).auditLog.create({
              data: {
                userId: userId || null,
                action: `delete_${model.toLowerCase()}`,
                tableName: model,
                recordId: (result as any).id || (args.where as any).id || '',
                changedFields: redactSensitiveFields(currentData || {}),
                tenantId,
              },
            });
          } catch (err) {
            console.error('[auditExtension] Failed to write delete audit log:', err);
          }

          return result;
        },
      },
    },
  });
});

/**
 * Admin actions an actor takes on someone else's record.
 *
 * `auditExtension` above attributes every row to the *record's* owner
 * (`createdById || assignedToId || userId`), which is right for "what happened to
 * my data" but wrong for "who did this to whom" — a director deactivating an SDR
 * lands under the SDR. Rather than flip the extension (which would silently
 * rewrite the meaning of every historical row and of the `AuditLog(userId)`
 * index), admin operations write an explicit actor-stamped row through here.
 *
 * Actions use a dotted `admin.*` namespace so they are trivially separable from
 * the extension's `create_user` / `update_campaign` rows.
 */
export const ADMIN_AUDIT_ACTIONS = [
  'admin.user.create',
  'admin.user.update',
  'admin.user.deactivate',
  'admin.user.reactivate',
  'admin.user.password_reset',
  'admin.user.sign_out_all',
  'admin.user.manager_change',
  'admin.user.role_change',
  'admin.campaign.member_add',
  'admin.campaign.member_remove',
  'admin.work.transfer.start',
  'admin.work.transfer',
  'admin.client.create',
  'admin.client.update',
  'admin.client.archive',
  // Management acts that were only in the all-changes feed. The Audit Log opens on "Admin
  // actions only", and in the 2026-09-19 role-play a director created a campaign and an ICP,
  // then opened the log and read "No audit entries in this window".
  'admin.campaign.create',
  'admin.campaign.update',
  'admin.campaign.archive',
  'admin.icp.create',
  'admin.icp.publish',
  // Changes which ICP scores every lead whose campaign has none of its own.
  'admin.icp.set_default',
  'admin.mailbox.pause',
  'admin.mailbox.resume',
  'admin.mailbox.cap',
  'admin.sequence.archive',
  'admin.sequence.update',
  'admin.sequence.senders',
  'admin.seed.reset',
  // A recorded phone call was played back (docs/dialer/TASKS.md D7.2).
  'admin.call.recording_play',
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export type AdminAuditInput = {
  actorId: string;
  action: AdminAuditAction;
  /** Prisma model name, or a synthetic one like `WorkTransfer` for multi-model ops. */
  tableName: string;
  recordId: string;
  changedFields?: Record<string, unknown>;
  /** The user this action was performed *on*, when that differs from `recordId`. */
  targetUserId?: string;
  reason?: string;
};

/**
 * Write one actor-stamped audit row. Never throws — an audit failure must not
 * fail the admin action it describes (same contract as `auditExtension`).
 *
 * The Prisma client is imported lazily: `lib/prisma.ts` imports `auditExtension`
 * from this module at load time, so a top-level `import { prisma }` here would
 * close a module cycle.
 */
export async function logAdminAudit(input: AdminAuditInput): Promise<void> {
  try {
    const { prisma } = await import('./prisma');
    await prisma.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        tableName: input.tableName,
        recordId: input.recordId,
        changedFields: redactSensitiveFields({
          ...(input.changedFields ?? {}),
          __actor: input.actorId,
          ...(input.targetUserId ? { __target: input.targetUserId } : {}),
          ...(input.reason ? { __reason: input.reason } : {}),
        }),
      },
    });
  } catch (err) {
    console.error('[logAdminAudit] Failed to write admin audit log:', err);
  }
}
