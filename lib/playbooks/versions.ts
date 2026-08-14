import { prisma } from '@/lib/prisma';
import { parsePlaybookRules, type PlaybookRules } from './policy';
import type { CampaignPlaybookVersion } from '@prisma/client';

/**
 * Playbook version lifecycle (Revenue AI Phase 4).
 *
 * `draft → approved → superseded`, and the transitions live here rather than being scattered
 * across routes. Activation in particular must be one service: it is a two-row swap, and two
 * callers doing it by hand would eventually leave a campaign with two active versions or none.
 *
 * ## Why not a transaction
 *
 * The Neon HTTP driver has no interactive transactions, and `lib/prisma.ts`'s `$extends`
 * wrappers defeat array batching — the same constraint that shaped `lib/admin/transferWork.ts`.
 * Wrapping this in `$transaction` would look atomic and not be, which is worse than not
 * pretending. So the swap is ordered, idempotent and its intermediate state is detectable:
 * `detectActivationDrift` finds a playbook whose pointer disagrees with its version rows, and
 * re-running `activateVersion` repairs it.
 */

export class PlaybookVersionError extends Error {
  constructor(message: string, readonly code: PlaybookVersionErrorCode) {
    super(message);
    this.name = 'PlaybookVersionError';
  }
}

export type PlaybookVersionErrorCode =
  | 'not_found'
  | 'wrong_tenant'
  | 'not_approved'
  | 'immutable'
  | 'superseded';

export interface CreateDraftInput {
  playbookId: string;
  tenantId: string;
  createdById: string;
  rules: unknown;
  /**
   * The proposal whose approval produced this draft, when one did.
   *
   * Unique on the version, so a second draft for the same proposal is refused by the database
   * rather than by whichever statement happened to run first.
   */
  fromProposalId?: string | null;
}

/**
 * Create the next draft.
 *
 * This is also how an approved version is "edited": it is not. Editing produces a new draft
 * carrying the old rules forward, which is what keeps the historical record honest.
 */
export async function createDraftVersion(input: CreateDraftInput): Promise<CampaignPlaybookVersion> {
  const rules = parsePlaybookRules(input.rules);
  const playbook = await requirePlaybook(input.playbookId, input.tenantId);

  const latest = await prisma.campaignPlaybookVersion.findFirst({
    where: { playbookId: playbook.id },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });

  return prisma.campaignPlaybookVersion.create({
    data: {
      tenantId: input.tenantId,
      playbookId: playbook.id,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      status: 'draft',
      rules: rules as unknown as object,
      createdById: input.createdById,
      fromProposalId: input.fromProposalId ?? null,
    },
  });
}

/** Copy an existing version's policy into a fresh draft — the supported way to "change" one. */
export async function draftFromVersion(
  versionId: string,
  tenantId: string,
  createdById: string,
  overrides?: Partial<PlaybookRules>
): Promise<CampaignPlaybookVersion> {
  const source = await requireVersion(versionId, tenantId);
  const merged = { ...(source.rules as object), ...(overrides ?? {}) };
  return createDraftVersion({
    playbookId: source.playbookId,
    tenantId,
    createdById,
    rules: merged,
  });
}

/**
 * Approve a draft. Approval is what makes a version eligible for activation, and it is the
 * point after which the policy is frozen.
 */
export async function approveVersion(
  versionId: string,
  tenantId: string,
  approvedById: string
): Promise<CampaignPlaybookVersion> {
  const version = await requireVersion(versionId, tenantId);

  if (version.status === 'approved') return version; // idempotent
  if (version.status === 'superseded') {
    throw new PlaybookVersionError('A superseded version cannot be approved again', 'superseded');
  }

  // Compare-and-set on status: two concurrent approvals cannot both stamp an approver.
  const claimed = await prisma.campaignPlaybookVersion.updateMany({
    where: { id: versionId, status: 'draft' },
    data: { status: 'approved', approvedById, approvedAt: new Date() },
  });
  if (claimed.count !== 1) return requireVersion(versionId, tenantId);

  return requireVersion(versionId, tenantId);
}

/**
 * Reject any edit to a version that is no longer a draft.
 *
 * Approved and superseded versions are immutable. Everything downstream — attribution,
 * "did reply rate improve after v4?", an audit of what a campaign was authorised to do —
 * depends on the stored policy still being the policy that ran.
 */
export async function updateDraftRules(
  versionId: string,
  tenantId: string,
  rules: unknown
): Promise<CampaignPlaybookVersion> {
  const version = await requireVersion(versionId, tenantId);
  if (version.status !== 'draft') {
    throw new PlaybookVersionError(
      `Version ${version.versionNumber} is ${version.status} and cannot be edited; create a new draft`,
      'immutable'
    );
  }

  const parsed = parsePlaybookRules(rules);
  const claimed = await prisma.campaignPlaybookVersion.updateMany({
    where: { id: versionId, status: 'draft' },
    data: { rules: parsed as unknown as object },
  });
  if (claimed.count !== 1) {
    // It was approved between the read and the write. Losing the edit is correct.
    throw new PlaybookVersionError('Version was approved before the edit landed', 'immutable');
  }

  return requireVersion(versionId, tenantId);
}

export interface ActivationResult {
  version: CampaignPlaybookVersion;
  /** False when this version was already the active one. */
  changed: boolean;
  /** The version this activation superseded, if any. */
  supersededVersionId: string | null;
  boundaryAt: Date;
}

/**
 * Make an approved version the one in force.
 *
 * Only an approved version may be activated, at most one is active per playbook at any
 * instant, and the outgoing version is superseded at **the same timestamp** the incoming one
 * is activated — so the half-open windows `[activatedAt, supersededAt)` tile the timeline with
 * no gap and no overlap. An event at time T belongs to exactly one version.
 */
export async function activateVersion(
  versionId: string,
  tenantId: string,
  boundaryAt: Date = new Date()
): Promise<ActivationResult> {
  const version = await requireVersion(versionId, tenantId);

  if (version.status === 'superseded') {
    throw new PlaybookVersionError(
      'A superseded version cannot be reactivated; create a new version from it instead',
      'superseded'
    );
  }
  if (version.status !== 'approved') {
    throw new PlaybookVersionError(
      `Version ${version.versionNumber} is ${version.status}; only an approved version may be activated`,
      'not_approved'
    );
  }

  const playbook = await requirePlaybook(version.playbookId, tenantId);

  // Idempotent: repeating the same activation request is a no-op, including the pointer
  // repair below if a previous attempt died before it.
  if (version.activatedAt && !version.supersededAt) {
    if (playbook.currentVersionId !== version.id) {
      await prisma.campaignPlaybook.update({
        where: { id: playbook.id },
        data: { currentVersionId: version.id },
      });
    }
    return {
      version,
      changed: false,
      supersededVersionId: null,
      boundaryAt: version.activatedAt,
    };
  }

  // Supersede the outgoing version first. A crash here leaves the playbook pointing at a
  // superseded version — visible to `detectActivationDrift`, and repaired by re-running this
  // call. The reverse order would briefly leave two versions active, which silently
  // mis-attributes every event in the gap.
  const outgoing = await prisma.campaignPlaybookVersion.findFirst({
    where: {
      playbookId: playbook.id,
      activatedAt: { not: null },
      supersededAt: null,
      id: { not: version.id },
    },
    select: { id: true },
  });

  if (outgoing) {
    await prisma.campaignPlaybookVersion.updateMany({
      where: { id: outgoing.id, supersededAt: null },
      data: { status: 'superseded', supersededAt: boundaryAt },
    });
  }

  const activated = await prisma.campaignPlaybookVersion.updateMany({
    where: { id: version.id, status: 'approved', activatedAt: null },
    data: { activatedAt: boundaryAt },
  });

  await prisma.campaignPlaybook.update({
    where: { id: playbook.id },
    data: { currentVersionId: version.id },
  });

  return {
    version: await requireVersion(versionId, tenantId),
    changed: activated.count === 1,
    supersededVersionId: outgoing?.id ?? null,
    boundaryAt,
  };
}

/**
 * Which version was in force at an instant.
 *
 * The Phase 4 attribution primitive: outcomes are attributed by the activation window rather
 * than by a stored id, because nothing writes such an id yet. Phase 6 adds explicit
 * `playbookVersionId` columns on work orders and agent actions — provenance should not rest on
 * time inference once a writer exists.
 */
export async function versionActiveAt(
  playbookId: string,
  tenantId: string,
  at: Date
): Promise<CampaignPlaybookVersion | null> {
  return prisma.campaignPlaybookVersion.findFirst({
    where: {
      playbookId,
      tenantId,
      activatedAt: { lte: at },
      OR: [{ supersededAt: null }, { supersededAt: { gt: at } }],
    },
    orderBy: { activatedAt: 'desc' },
  });
}

export interface ActivationDrift {
  playbookId: string;
  currentVersionId: string | null;
  actualActiveVersionId: string | null;
}

/**
 * Find playbooks whose pointer disagrees with their version rows.
 *
 * This is the detectable intermediate state the non-transactional swap trades for. It is a
 * repair *query*, not a normal recovery path: re-running `activateVersion` on the intended
 * version fixes any row it returns.
 */
export async function detectActivationDrift(tenantId: string): Promise<ActivationDrift[]> {
  const playbooks = await prisma.campaignPlaybook.findMany({
    where: { tenantId },
    select: { id: true, currentVersionId: true },
  });

  const drift: ActivationDrift[] = [];
  for (const playbook of playbooks) {
    const active = await prisma.campaignPlaybookVersion.findFirst({
      where: { playbookId: playbook.id, activatedAt: { not: null }, supersededAt: null },
      select: { id: true },
    });
    if ((active?.id ?? null) !== (playbook.currentVersionId ?? null)) {
      drift.push({
        playbookId: playbook.id,
        currentVersionId: playbook.currentVersionId,
        actualActiveVersionId: active?.id ?? null,
      });
    }
  }
  return drift;
}

async function requirePlaybook(playbookId: string, tenantId: string) {
  const playbook = await prisma.campaignPlaybook.findUnique({
    where: { id: playbookId },
    select: { id: true, tenantId: true, currentVersionId: true },
  });
  if (!playbook) throw new PlaybookVersionError(`Playbook ${playbookId} not found`, 'not_found');
  // Tenant ownership is checked at the domain boundary, on top of the Prisma tenant extension —
  // a caller must not be able to reach another tenant's policy by knowing an id.
  if (playbook.tenantId !== tenantId) {
    throw new PlaybookVersionError('Playbook belongs to another tenant', 'wrong_tenant');
  }
  return playbook;
}

async function requireVersion(versionId: string, tenantId: string): Promise<CampaignPlaybookVersion> {
  const version = await prisma.campaignPlaybookVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new PlaybookVersionError(`Version ${versionId} not found`, 'not_found');
  if (version.tenantId !== tenantId) {
    throw new PlaybookVersionError('Version belongs to another tenant', 'wrong_tenant');
  }
  return version;
}
