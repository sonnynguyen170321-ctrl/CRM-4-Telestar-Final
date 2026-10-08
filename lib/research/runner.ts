import { randomUUID } from 'node:crypto';

import type { ResearchRunStatus } from '@prisma/client';

import { enqueue } from '@/lib/bullmq/enqueue';
import { JobType, type ResearchDiscoverPayload } from '@/lib/bullmq/types';
import { prisma } from '@/lib/prisma';
import { DISCOVERY_QUERY_BATCH, runDiscoveryPass, type DiscoveryPassResult } from './discovery';
import { STALE_RUNNER_MS } from './readModel';
import { reopenVerification } from './verify';

export { STALE_RUNNER_MS };

/**
 * Research runs execute on the `research` queue, not in the browser tab.
 *
 * Until this module, `ResearchWorkspace.executeRun` was the runner: it looped
 * `POST /api/research/runs/[id]/execute`, ten queries a request, for as long as the tab stayed
 * mounted. Navigating away stopped the run at the next batch boundary and left it `running`
 * forever; a 50-query run only reached 50 if the SDR sat and watched it; and two tabs — or a reload
 * mid-request — ran the same queries twice, paid for them twice, and counted every result a second
 * time as a duplicate, because nothing stopped two passes reading the same cursor.
 *
 * The shape now:
 *
 *   - **One runner per run is a status claim, not a convention.** `startResearchRun` moves the row
 *     to `running` with a conditional `updateMany`; only the caller whose update matched enqueues.
 *     A double click, a second tab and a retrying proxy all find the run already `running` and
 *     enqueue nothing.
 *   - **A job is a slice, not the whole run.** It runs at most `PASSES_PER_SLICE` passes and then
 *     enqueues its own continuation. A 1,000-query run therefore never holds a worker slot for an
 *     hour in front of other tenants, and a deploy that kills the worker loses one slice, not the
 *     run — the cursor is persisted per query.
 *   - **Pause is a row flag the worker honours between passes.** The batch in flight always
 *     finishes, so the cursor is never left mid-query.
 *   - **A dead runner is detectable.** Every query writes the row, so a `running` run whose
 *     `updatedAt` is older than `STALE_RUNNER_MS` has nobody working it, and Resume may claim it.
 *   - **No outcome is silent.** A slice that throws, a pass that makes no progress, and a
 *     continuation that could not be queued all leave the run in a state that says why.
 */

/** Passes one job runs before handing over to its continuation: 5 × 10 = 50 queries. */
export const PASSES_PER_SLICE = 5;


const STALLED_MESSAGE =
  'The run stopped making progress: a batch completed without running any query. Check provider ' +
  'readiness and resume.';

export class ResearchRunnerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `The background worker could not be reached, so the run was not started: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'ResearchRunnerUnavailableError';
  }
}

type EnqueueFn = (payload: ResearchDiscoverPayload, tenantId: string) => Promise<unknown>;

const defaultEnqueue: EnqueueFn = (payload, tenantId) =>
  enqueue(JobType.RESEARCH_DISCOVER, payload, { tenantId });

export type StartResearchRunResult =
  | { status: 'started' }
  | { status: 'already_running' }
  | { status: 'already_finished'; runStatus: ResearchRunStatus }
  | { status: 'not_found' };

/**
 * Claim a run and queue its first slice.
 *
 * Startable: a fresh `queued` run, a `paused` one, a `failed` one that still has queries left, and
 * a `running` one nobody has written to for `STALE_RUNNER_MS`. A `failed` run whose cursor has
 * reached the end stays failed — re-entering it would re-derive the verdict from a pass that
 * searched nothing, and a run that failed for a dead API key would come back `succeeded`.
 */
export async function startResearchRun(input: {
  tenantId: string;
  runId: string;
  now?: Date;
  enqueueSlice?: EnqueueFn;
}): Promise<StartResearchRunResult> {
  const { tenantId, runId } = input;
  const now = input.now ?? new Date();
  const enqueueSlice = input.enqueueSlice ?? defaultEnqueue;

  const run = await prisma.researchRun.findFirst({
    where: { id: runId, tenantId },
    select: { status: true, queryCursor: true, queriesJson: true },
  });
  if (!run) return { status: 'not_found' };

  const totalQueries = Array.isArray(run.queriesJson) ? run.queriesJson.length : 0;
  // A `running` or `paused` run at the end of its cursor is let through: it died between its last
  // query and its final status write, and one pass over nothing is what writes that status.
  if (run.status === 'succeeded') return { status: 'already_finished', runStatus: run.status };
  // A run whose discovery is finished may still have verification to do: candidates waiting to be
  // checked, or ones a dead classifier left unchecked (reopened here). Only with neither is it finished —
  // otherwise "Resume to try again" on a run that failed verification would be a dead end.
  if (run.status === 'failed' && run.queryCursor >= totalQueries && (await reopenVerification(tenantId, runId)) === 0) {
    return { status: 'already_finished', runStatus: run.status };
  }

  const claimed = await prisma.researchRun.updateMany({
    where: {
      id: runId,
      tenantId,
      // The cursor read above is part of the claim: a run that moved on between the read and this
      // write is not the run that was judged startable.
      queryCursor: run.queryCursor,
      OR: [
        { status: { in: ['queued', 'paused', 'failed'] } },
        { status: 'running', updatedAt: { lt: new Date(now.getTime() - STALE_RUNNER_MS) } },
      ],
    },
    data: { status: 'running', pauseRequestedAt: null, errorMessage: null, finishedAt: null },
  });
  if (claimed.count === 0) return { status: 'already_running' };

  try {
    await enqueueSlice({ runId, startToken: randomUUID() }, tenantId);
  } catch (error) {
    // The claim is undone rather than left standing: a `running` row with no job behind it would
    // read as progress for five minutes and then as a stall nobody caused.
    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId, status: 'running' },
      data: {
        status: run.status === 'running' ? 'paused' : run.status,
        errorMessage: 'The background worker could not be reached. Resume once it is back.',
      },
    });
    throw new ResearchRunnerUnavailableError(error);
  }

  return { status: 'started' };
}

export type PauseResearchRunResult = { status: 'pause_requested' | 'paused' | 'not_running' | 'not_found' };

/**
 * Ask a run to stop at the next batch boundary.
 *
 * A `running` run gets a flag and keeps its status: the worker owns the move to `paused`, after the
 * batch it is executing has written its cursor. A `queued` run has no worker yet and pauses at once.
 */
export async function pauseResearchRun(input: {
  tenantId: string;
  runId: string;
  now?: Date;
}): Promise<PauseResearchRunResult> {
  const { tenantId, runId } = input;
  const now = input.now ?? new Date();

  const requested = await prisma.researchRun.updateMany({
    where: { id: runId, tenantId, status: 'running' },
    data: { pauseRequestedAt: now },
  });
  if (requested.count > 0) return { status: 'pause_requested' };

  const pausedQueued = await prisma.researchRun.updateMany({
    where: { id: runId, tenantId, status: 'queued' },
    data: { status: 'paused' },
  });
  if (pausedQueued.count > 0) return { status: 'paused' };

  const exists = await prisma.researchRun.findFirst({ where: { id: runId, tenantId }, select: { id: true } });
  return { status: exists ? 'not_running' : 'not_found' };
}

export type ResearchSliceOutcome =
  | 'finished'
  | 'paused'
  | 'continued'
  | 'stalled'
  | 'not_running'
  | 'not_found'
  | 'continuation_unqueued';

type PassFn = (params: { tenantId: string; runId: string; maxQueries: number }) => Promise<DiscoveryPassResult>;

/**
 * The `research.discover` processor: run up to `PASSES_PER_SLICE` passes, then hand over.
 *
 * Re-reads the row before every pass, so a Pause, a run finished by another path, or a run that is
 * no longer `running` for any reason stops this slice at the boundary rather than after five
 * batches. Throws only after marking the run `failed` with the reason, so the job's own failure in
 * `JobRun` and the run's status the operator sees say the same thing.
 */
export async function runResearchSlice(
  payload: ResearchDiscoverPayload,
  tenantId: string,
  deps: { runPass?: PassFn; enqueueSlice?: EnqueueFn } = {}
): Promise<{ outcome: ResearchSliceOutcome; passes: number }> {
  const runPass = deps.runPass ?? runDiscoveryPass;
  const enqueueSlice = deps.enqueueSlice ?? defaultEnqueue;
  const { runId } = payload;
  let passes = 0;

  try {
    for (; passes < PASSES_PER_SLICE; ) {
      const run = await prisma.researchRun.findFirst({
        where: { id: runId, tenantId },
        select: { status: true, pauseRequestedAt: true },
      });
      if (!run) return { outcome: 'not_found', passes };
      if (run.status !== 'running') return { outcome: 'not_running', passes };

      if (run.pauseRequestedAt) {
        await prisma.researchRun.updateMany({
          where: { id: runId, tenantId, status: 'running' },
          data: { status: 'paused', pauseRequestedAt: null },
        });
        return { outcome: 'paused', passes };
      }

      const pass = await runPass({ tenantId, runId, maxQueries: DISCOVERY_QUERY_BATCH });
      passes += 1;

      // `runDiscoveryPass` writes the final status itself, succeeded or failed with the reason.
      if (pass.finished) return { outcome: 'finished', passes };

      if (pass.queriesRun === 0) {
        await prisma.researchRun.updateMany({
          where: { id: runId, tenantId, status: 'running' },
          data: { status: 'failed', errorMessage: STALLED_MESSAGE },
        });
        return { outcome: 'stalled', passes };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId, status: 'running' },
      data: { status: 'failed', errorMessage: `Discovery stopped on an error: ${message}. Resume to retry from here.` },
    });
    throw error;
  }

  try {
    await enqueueSlice({ runId, startToken: randomUUID() }, tenantId);
  } catch (error) {
    // Left `running`, this would look like progress until it went stale. `paused` with the reason is
    // the truth: nothing is working the run, and Resume continues from the cursor.
    console.error('[research] could not queue the next slice', { runId, error });
    await prisma.researchRun.updateMany({
      where: { id: runId, tenantId, status: 'running' },
      data: {
        status: 'paused',
        errorMessage: 'The next batch could not be queued (background worker unreachable). Resume to continue.',
      },
    });
    return { outcome: 'continuation_unqueued', passes };
  }

  return { outcome: 'continued', passes };
}
