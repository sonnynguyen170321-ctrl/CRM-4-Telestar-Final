import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import type { ImportParsePayload } from '@/lib/bullmq/types';
import {
  handleImportParse,
  handleImportChunk,
  handleImportCommit,
  type ImportDispatcher,
} from '@/workers/import';

/**
 * Largest batch we are willing to commit inside a single request. Above this the
 * caller must wait for a real worker — a serverless request would time out first.
 */
export const INLINE_IMPORT_MAX_ROWS = 2000;

export interface InlineImportResult {
  imported: number;
  updated: number;
  errored: number;
}

/**
 * Run parse → chunk → commit synchronously, without touching Redis.
 *
 * Used only as a degraded path when the queue is unreachable: the row-level logic
 * is the exact same handler code the worker runs, so a lead imported inline is
 * indistinguishable from one imported by a worker (same activities, same
 * `ImportRow` status transitions, same `ImportBatch` lifecycle).
 */
export async function runImportInline(payload: ImportParsePayload): Promise<InlineImportResult> {
  const inlineDispatcher: ImportDispatcher = {
    chunk: (chunkPayload) => handleImportChunk(chunkPayload),
    commit: (commitPayload) => handleImportCommit(commitPayload),
  };

  await tenantStorage.run({ tenantId: payload.tenantId, bypassRls: true }, async () => {
    await handleImportParse(payload, inlineDispatcher);
  });

  const [imported, updated, errored] = await Promise.all([
    prisma.importRow.count({ where: { batchId: payload.batchId, status: 'imported' } }),
    prisma.importRow.count({ where: { batchId: payload.batchId, status: 'updated' } }),
    prisma.importRow.count({ where: { batchId: payload.batchId, status: 'error' } }),
  ]);

  return { imported, updated, errored };
}
