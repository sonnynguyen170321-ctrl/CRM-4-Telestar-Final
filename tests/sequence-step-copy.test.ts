import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Approved per-occurrence copy — the service, and the boundary it exists to hold (Plan 1 §A4).
 *
 * The rule under test: by the time a sequence task is executable, its prospect-facing content is
 * already durable, and the send path never asks a model what to say. The last describe block
 * enforces that structurally rather than by review, because an `import` added in a hurry is
 * exactly how a provider call gets into an execution spine.
 */

const mockEnrollmentFindUnique = vi.fn();
const mockCopyUpsert = vi.fn();
const mockCopyFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sequenceEnrollment: { findUnique: (...a: unknown[]) => mockEnrollmentFindUnique(...a) },
    sequenceStepCopy: {
      upsert: (...a: unknown[]) => mockCopyUpsert(...a),
      findUnique: (...a: unknown[]) => mockCopyFindUnique(...a),
    },
  },
}));

const {
  materializeApprovedCopy,
  getApprovedStepCopy,
  isPersonalizationEnabled,
  parseApprovedCopy,
  StepCopyRefusedError,
} = await import('@/lib/sequences/stepCopy');

const TENANT = 'tenant-1';
const ENROLLMENT = 'enr-1';

describe('materializeApprovedCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnrollmentFindUnique.mockResolvedValue({ id: ENROLLMENT, tenantId: TENANT, status: 'active' });
    mockCopyUpsert.mockResolvedValue({});
  });

  it('writes one approved body per step, keyed by the occurrence', async () => {
    const written = await materializeApprovedCopy({
      enrollmentId: ENROLLMENT,
      tenantId: TENANT,
      steps: [
        { stepOrder: 1, subject: 'One', body: 'Body one', citedEvidenceIds: ['ev-1'], aiGenerated: true },
        { stepOrder: 2, body: 'Body two' },
      ],
    });

    expect(written).toBe(2);
    expect(mockCopyUpsert).toHaveBeenCalledTimes(2);
    expect(mockCopyUpsert.mock.calls[0][0].where).toEqual({
      enrollmentId_stepOrder: { enrollmentId: ENROLLMENT, stepOrder: 1 },
    });
    expect(mockCopyUpsert.mock.calls[0][0].create).toMatchObject({
      body: 'Body one',
      citedEvidenceIds: ['ev-1'],
      aiGenerated: true,
      tenantId: TENANT,
    });
  });

  it('upserts rather than inserts, so a retried approval cannot produce two bodies for one step', async () => {
    await materializeApprovedCopy({
      enrollmentId: ENROLLMENT,
      tenantId: TENANT,
      steps: [{ stepOrder: 1, body: 'Body' }],
    });

    const call = mockCopyUpsert.mock.calls[0][0];
    expect(call.update).toBeDefined();
    expect(call.update.body).toBe('Body');
  });

  it('refuses copy for an enrollment in another tenant', async () => {
    mockEnrollmentFindUnique.mockResolvedValue({ id: ENROLLMENT, tenantId: 'tenant-2', status: 'active' });

    await expect(
      materializeApprovedCopy({
        enrollmentId: ENROLLMENT,
        tenantId: TENANT,
        steps: [{ stepOrder: 1, body: 'Body' }],
      })
    ).rejects.toBeInstanceOf(StepCopyRefusedError);

    expect(mockCopyUpsert).not.toHaveBeenCalled();
  });

  it('refuses an enrollment that does not exist', async () => {
    mockEnrollmentFindUnique.mockResolvedValue(null);

    await expect(
      materializeApprovedCopy({
        enrollmentId: 'ghost',
        tenantId: TENANT,
        steps: [{ stepOrder: 1, body: 'Body' }],
      })
    ).rejects.toBeInstanceOf(StepCopyRefusedError);
  });

  it('refuses an empty body rather than approving a blank email', async () => {
    await expect(
      materializeApprovedCopy({
        enrollmentId: ENROLLMENT,
        tenantId: TENANT,
        steps: [{ stepOrder: 1, body: '   ' }],
      })
    ).rejects.toBeInstanceOf(StepCopyRefusedError);
  });
});

/**
 * Validation of copy that arrived from outside the module — an approval payload, an agent tool
 * call, an API body. `materializeApprovedCopy` takes a typed `ApprovedStepCopy[]`; nothing
 * produces that type from untrusted input until this function does.
 *
 * Every case below asserts a **refusal**, never a repair. That is the whole point: a parser that
 * dropped the malformed entry and kept going would send the shared template to a prospect a human
 * believed they had personalized for, and no row anywhere would record the substitution. A refusal
 * is loud and recoverable; a silent fallback is neither.
 */
describe('parseApprovedCopy', () => {
  it('normalizes a valid payload into the shape materializeApprovedCopy consumes', () => {
    const parsed = parseApprovedCopy([
      { stepOrder: 1, subject: 'Hello', body: 'Body one', citedEvidenceIds: ['ev-1'], aiGenerated: true },
      { stepOrder: 2, body: 'Body two' },
    ]);

    expect(parsed).toEqual([
      { stepOrder: 1, subject: 'Hello', body: 'Body one', citedEvidenceIds: ['ev-1'], aiGenerated: true },
      { stepOrder: 2, subject: null, body: 'Body two', citedEvidenceIds: [], aiGenerated: false },
    ]);
  });

  it('refuses a payload that is not an array', () => {
    expect(() => parseApprovedCopy({ stepOrder: 1, body: 'Body' })).toThrow(StepCopyRefusedError);
    expect(() => parseApprovedCopy('Body')).toThrow(StepCopyRefusedError);
  });

  it('refuses an empty array, because omitting the field is what means "use the template"', () => {
    expect(() => parseApprovedCopy([])).toThrow(StepCopyRefusedError);
  });

  it('refuses an entry that is not an object', () => {
    expect(() => parseApprovedCopy(['Body'])).toThrow(StepCopyRefusedError);
    expect(() => parseApprovedCopy([null])).toThrow(StepCopyRefusedError);
  });

  it('refuses a duplicate stepOrder rather than letting the upsert pick a winner', () => {
    expect(() =>
      parseApprovedCopy([
        { stepOrder: 1, body: 'First body' },
        { stepOrder: 1, body: 'Second body' },
      ])
    ).toThrow(StepCopyRefusedError);
  });

  it('refuses a stepOrder that is not a positive integer', () => {
    for (const stepOrder of [0, -1, 1.5, '1', null, undefined]) {
      expect(() => parseApprovedCopy([{ stepOrder, body: 'Body' }])).toThrow(StepCopyRefusedError);
    }
  });

  it('refuses a missing or blank body rather than approving a blank email', () => {
    expect(() => parseApprovedCopy([{ stepOrder: 1 }])).toThrow(StepCopyRefusedError);
    expect(() => parseApprovedCopy([{ stepOrder: 1, body: '   ' }])).toThrow(StepCopyRefusedError);
    expect(() => parseApprovedCopy([{ stepOrder: 1, body: 42 }])).toThrow(StepCopyRefusedError);
  });

  it('accepts an omitted or null subject, and refuses a non-string one', () => {
    expect(parseApprovedCopy([{ stepOrder: 1, body: 'Body', subject: null }])[0].subject).toBeNull();
    expect(() => parseApprovedCopy([{ stepOrder: 1, body: 'Body', subject: 7 }])).toThrow(
      StepCopyRefusedError
    );
  });

  it('refuses a citedEvidenceIds that is not a list of strings', () => {
    expect(() =>
      parseApprovedCopy([{ stepOrder: 1, body: 'Body', citedEvidenceIds: 'ev-1' }])
    ).toThrow(StepCopyRefusedError);
    expect(() =>
      parseApprovedCopy([{ stepOrder: 1, body: 'Body', citedEvidenceIds: ['ev-1', 2] }])
    ).toThrow(StepCopyRefusedError);
  });

  it('bounds step count, body length and subject length', () => {
    const oneStep = (over: Record<string, unknown>) => [{ stepOrder: 1, body: 'Body', ...over }];

    expect(() =>
      parseApprovedCopy(Array.from({ length: 26 }, (_, i) => ({ stepOrder: i + 1, body: 'Body' })))
    ).toThrow(StepCopyRefusedError);
    expect(() => parseApprovedCopy(oneStep({ body: 'x'.repeat(20_001) }))).toThrow(
      StepCopyRefusedError
    );
    expect(() => parseApprovedCopy(oneStep({ subject: 'x'.repeat(501) }))).toThrow(
      StepCopyRefusedError
    );
  });

  it('names the offending step in the refusal, so an operator can fix the right one', () => {
    expect(() =>
      parseApprovedCopy([
        { stepOrder: 1, body: 'Fine' },
        { stepOrder: 4, body: '' },
      ])
    ).toThrow(/step 4/);
  });
});

describe('getApprovedStepCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for a cadence that has no approved copy, so the template is used', async () => {
    mockCopyFindUnique.mockResolvedValue(null);
    await expect(getApprovedStepCopy(ENROLLMENT, 1)).resolves.toBeNull();
  });

  it('does not query at all for a legacy task with no occurrence id', async () => {
    await expect(getApprovedStepCopy(null, 1)).resolves.toBeNull();
    await expect(getApprovedStepCopy(ENROLLMENT, null)).resolves.toBeNull();
    expect(mockCopyFindUnique).not.toHaveBeenCalled();
  });
});

describe('personalization flag', () => {
  it('is off unless explicitly enabled', () => {
    delete process.env.SEQUENCE_AI_PERSONALIZATION;
    expect(isPersonalizationEnabled()).toBe(false);

    process.env.SEQUENCE_AI_PERSONALIZATION = 'yes';
    expect(isPersonalizationEnabled()).toBe(false);

    process.env.SEQUENCE_AI_PERSONALIZATION = 'true';
    expect(isPersonalizationEnabled()).toBe(true);

    delete process.env.SEQUENCE_AI_PERSONALIZATION;
  });
});

/**
 * The structural half of the rule.
 *
 * `tests/ai-optional.test.ts` holds the client/server boundary; this holds the *execution*
 * boundary. If a future change imports `lib/ai` into the send path, the copy a prospect receives
 * starts depending on whether a provider answered — and that failure is invisible in every other
 * test, because a mocked provider always answers.
 */
describe('the send path cannot reach an AI provider', () => {
  const root = process.cwd();

  /** Files that decide or perform what a prospect receives. */
  const SEND_PATH = [
    'workers/sequence.ts',
    'workers/email.ts',
    'lib/sequences/stepCopy.ts',
    'lib/sequences/engine.ts',
    'lib/automation/eligibility.ts',
    'lib/automation/scheduling.ts',
    'lib/workflows/email.ts',
  ];

  const AI_IMPORT = /from\s+['"]@\/lib\/ai\/|from\s+['"]groq-sdk['"]|from\s+['"]@google\/gener/;

  it.each(SEND_PATH)('%s imports nothing from the AI layer', (file) => {
    const source = readFileSync(join(root, file), 'utf8');
    expect(AI_IMPORT.test(source)).toBe(false);
  });

  it('no file under lib/sequences imports the AI layer', () => {
    const dir = join(root, 'lib', 'sequences');
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      expect(AI_IMPORT.test(source), `${name} must not import lib/ai`).toBe(false);
    }
  });
});
