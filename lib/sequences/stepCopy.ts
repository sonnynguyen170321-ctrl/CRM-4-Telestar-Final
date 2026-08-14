import { prisma } from '@/lib/prisma';

/**
 * Approved per-occurrence copy (Plan 1 §A4).
 *
 * ## The rule this module exists to make structural
 *
 * **By the time a sequence task is executable, its prospect-facing content is already durable.**
 * Personalization is prepared and approved at design time and written here; the worker reads it.
 * Nothing in the send path asks a model what to say.
 *
 * That is not a style preference. If an LLM call sat in the execution spine, the same approved
 * cadence would send different words depending on whether a provider happened to answer, a retry
 * would spend tokens before the durable outbound row existed, and provider latency would become
 * part of the worker's critical path. "AI is down" has to mean the approved sequence still goes
 * out unchanged — not that the system quietly sends something else.
 *
 * ## Why this file imports nothing from `lib/ai`
 *
 * It takes plain strings. Whoever approved the copy — a grounded draft, a human edit, or the
 * deterministic evidence-only fallback — resolved it before calling here. `lib/sequences/` stays
 * free of AI dependencies, which `tests/ai-optional.test.ts` enforces structurally.
 *
 * ## Keyed by occurrence, not by lead
 *
 * A replacement cadence is a different conversation. Copy approved for the enrollment a human
 * cancelled must not be inherited by the one that replaced it, so the key is
 * `(enrollmentId, stepOrder)` and a terminal enrollment's rows go with it on cascade.
 */

/** One approved step's content, as the approval path resolved it. */
export interface ApprovedStepCopy {
  stepOrder: number;
  subject?: string | null;
  body: string;
  citedEvidenceIds?: string[];
  /** False when the deterministic evidence-only fallback produced this copy. */
  aiGenerated?: boolean;
}

export interface MaterializeCopyInput {
  enrollmentId: string;
  tenantId: string;
  steps: ApprovedStepCopy[];
  /** The human who approved. Null for a system-approved deterministic fallback. */
  approvedById?: string | null;
}

/**
 * Is design-time personalization switched on for this deployment?
 *
 * Default **off**. Reading approved copy is always safe — it is durable, human-approved content —
 * but writing it is a behaviour change for every cadence a tenant launches, so it is opt-in.
 */
export function isPersonalizationEnabled(): boolean {
  return process.env.SEQUENCE_AI_PERSONALIZATION === 'true';
}

export class StepCopyRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepCopyRefusedError';
  }
}

/**
 * Persist approved copy for an occurrence, once.
 *
 * Idempotent through the `(enrollmentId, stepOrder)` unique key: a retried approval updates the
 * row it already wrote rather than adding a second body for the same step. It must be called
 * **before** the step's task and delayed job exist — that ordering is what makes "durable before
 * executable" true rather than merely intended, and `launchAIOutreach` enforces it by calling
 * this between `prepareEnrollment` and `finalizeFirstStep`.
 */
export async function materializeApprovedCopy(input: MaterializeCopyInput): Promise<number> {
  if (!input.tenantId) {
    throw new StepCopyRefusedError('Approved copy needs a tenant; refusing to write unscoped rows.');
  }

  // The enrollment must exist and belong to this tenant. Without the check a caller could attach
  // approved copy to another tenant's cadence, and the worker reads this by enrollment id alone.
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: input.enrollmentId },
    select: { id: true, tenantId: true, status: true },
  });
  if (!enrollment || enrollment.tenantId !== input.tenantId) {
    throw new StepCopyRefusedError(
      `Enrollment ${input.enrollmentId} does not belong to tenant ${input.tenantId}.`
    );
  }

  let written = 0;
  for (const step of input.steps) {
    if (!step.body?.trim()) {
      throw new StepCopyRefusedError(
        `Approved copy for step ${step.stepOrder} is empty; an empty body would send a blank email.`
      );
    }

    await prisma.sequenceStepCopy.upsert({
      where: {
        enrollmentId_stepOrder: { enrollmentId: input.enrollmentId, stepOrder: step.stepOrder },
      },
      // A repeat of the same approval is the same content; a genuinely revised approval replaces
      // it. Either way there is exactly one approved body per step.
      update: {
        subject: step.subject ?? null,
        body: step.body,
        citedEvidenceIds: step.citedEvidenceIds ?? [],
        aiGenerated: step.aiGenerated ?? false,
        approvedById: input.approvedById ?? null,
      },
      create: {
        enrollmentId: input.enrollmentId,
        stepOrder: step.stepOrder,
        subject: step.subject ?? null,
        body: step.body,
        citedEvidenceIds: step.citedEvidenceIds ?? [],
        aiGenerated: step.aiGenerated ?? false,
        approvedById: input.approvedById ?? null,
        tenantId: input.tenantId,
      },
    });
    written += 1;
  }

  return written;
}

/**
 * Bounds on a single approval payload. Long enough for real outreach, short enough that a
 * malformed or hostile caller cannot write an unbounded body into the send path.
 */
const MAX_STEPS = 25;
const MAX_BODY_LENGTH = 20_000;
const MAX_SUBJECT_LENGTH = 500;

/**
 * Validate copy that arrived from outside this module — an approval payload, an agent tool call,
 * an API body — into the typed shape `materializeApprovedCopy` consumes.
 *
 * It **throws** rather than dropping bad entries, and that is the whole design. This value becomes
 * the words a prospect reads, so "mostly parsed" is the wrong outcome: a silently discarded step
 * would send the shared template to someone a human believed they had personalized for, and
 * nothing would record the substitution.
 *
 * A duplicate `stepOrder` is refused for the same reason. `materializeApprovedCopy` upserts, so a
 * duplicate would quietly resolve to whichever entry happened to be written last.
 */
export function parseApprovedCopy(input: unknown): ApprovedStepCopy[] {
  if (!Array.isArray(input)) {
    throw new StepCopyRefusedError('Approved copy must be an array of steps.');
  }
  if (input.length === 0) {
    throw new StepCopyRefusedError('Approved copy was empty; omit it entirely to use the template.');
  }
  if (input.length > MAX_STEPS) {
    throw new StepCopyRefusedError(
      `Approved copy has ${input.length} steps; the limit is ${MAX_STEPS}.`
    );
  }

  const seen = new Set<number>();

  return input.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') {
      throw new StepCopyRefusedError(`Approved copy entry ${index} is not an object.`);
    }
    const entry = raw as Record<string, unknown>;

    const stepOrder = entry.stepOrder;
    if (typeof stepOrder !== 'number' || !Number.isInteger(stepOrder) || stepOrder < 1) {
      throw new StepCopyRefusedError(
        `Approved copy entry ${index} needs an integer stepOrder of 1 or more.`
      );
    }
    if (seen.has(stepOrder)) {
      throw new StepCopyRefusedError(`Approved copy names step ${stepOrder} more than once.`);
    }
    seen.add(stepOrder);

    const body = entry.body;
    if (typeof body !== 'string' || !body.trim()) {
      throw new StepCopyRefusedError(`Approved copy for step ${stepOrder} has no body.`);
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new StepCopyRefusedError(
        `Approved copy for step ${stepOrder} is ${body.length} characters; the limit is ${MAX_BODY_LENGTH}.`
      );
    }

    const subject = entry.subject;
    if (subject !== undefined && subject !== null && typeof subject !== 'string') {
      throw new StepCopyRefusedError(
        `Approved copy for step ${stepOrder} has a non-string subject.`
      );
    }
    if (typeof subject === 'string' && subject.length > MAX_SUBJECT_LENGTH) {
      throw new StepCopyRefusedError(
        `Approved copy subject for step ${stepOrder} exceeds ${MAX_SUBJECT_LENGTH} characters.`
      );
    }

    const citedEvidenceIds = entry.citedEvidenceIds;
    if (
      citedEvidenceIds !== undefined &&
      (!Array.isArray(citedEvidenceIds) || citedEvidenceIds.some((id) => typeof id !== 'string'))
    ) {
      throw new StepCopyRefusedError(
        `Approved copy for step ${stepOrder} has a malformed citedEvidenceIds list.`
      );
    }

    return {
      stepOrder,
      subject: typeof subject === 'string' ? subject : null,
      body,
      citedEvidenceIds: (citedEvidenceIds as string[] | undefined) ?? [],
      aiGenerated: entry.aiGenerated === true,
    };
  });
}

/**
 * The approved copy for one step of one occurrence, or null to fall back to the shared template.
 *
 * Null is the normal case for every cadence that predates personalization, which is why the
 * worker treats it as "use the template" rather than as an error.
 */
export async function getApprovedStepCopy(
  enrollmentId: string | null | undefined,
  stepOrder: number | null | undefined
): Promise<{ subject: string | null; body: string; aiGenerated: boolean } | null> {
  if (!enrollmentId || stepOrder === null || stepOrder === undefined) return null;

  const row = await prisma.sequenceStepCopy.findUnique({
    where: { enrollmentId_stepOrder: { enrollmentId, stepOrder } },
    select: { subject: true, body: true, aiGenerated: true },
  });

  return row ?? null;
}
