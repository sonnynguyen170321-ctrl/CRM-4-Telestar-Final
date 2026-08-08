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
          
          if (model === 'AuditLog' || model === 'Tenant') return result;

          try {
            const userId = (args.data as any).createdById || 
                           (args.data as any).assignedToId || 
                           (args.data as any).userId || 
                           null;
            
            const tenantId = (result as any).tenantId || 
                             (args.data as any).tenantId || 
                             tenantStorage.getStore()?.tenantId || 
                             'default-tenant';
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
          if (model === 'AuditLog' || model === 'Tenant') return query(args);

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
                    changedFields[key] = redactSensitiveFields({ old: oldValue, new: newValue });
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
                               tenantStorage.getStore()?.tenantId || 
                               'default-tenant';
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
          if (model === 'AuditLog' || model === 'Tenant') return query(args);

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
                             tenantStorage.getStore()?.tenantId || 
                             'default-tenant';
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
  'admin.seed.reset',
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
