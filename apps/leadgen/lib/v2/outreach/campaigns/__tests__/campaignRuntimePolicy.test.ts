import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decideCampaignLeadEligibility,
  prioritizeCampaignLeads,
} from "../eligibility";
import { prepareCampaignStepMessage } from "../messagePreparation";
import {
  CampaignRenderError,
  renderCampaignTemplate,
  renderDeterministicSpintax,
} from "../rendering";
import {
  isWithinCampaignWindow,
  nextCampaignWindow,
  resolveCampaignTimezone,
} from "../schedule";
import { assignDeterministicVariant } from "../variantAssignment";
import type { V2CampaignScheduleV1, V2EnrollmentRenderSnapshotV1 } from "../types";

const weekdaySchedule: V2CampaignScheduleV1 = {
  schemaVersion: "v2.campaign-schedule.v1",
  weekdays: [1, 2, 3, 4, 5],
  startLocalTime: "09:00",
  endLocalTime: "17:00",
};

describe("campaign eligibility", () => {
  it("requires an audited reason without mutating qualification", () => {
    expect(
      decideCampaignLeadEligibility({
        leadAssignmentId: "lead-1",
        qualification: "NEEDS_REVIEW",
        fitScore: 90,
        email: "lead@example.com",
        suppressed: false,
      })
    ).toMatchObject({ eligible: false, code: "OVERRIDE_REQUIRED" });
    expect(
      decideCampaignLeadEligibility({
        leadAssignmentId: "lead-1",
        qualification: "NEEDS_REVIEW",
        fitScore: 90,
        email: "lead@example.com",
        suppressed: false,
        overrideReason: "Approved target persona",
      })
    ).toEqual({ eligible: true, requiresOverride: true });
  });

  it("prioritizes qualification then fit score", () => {
    const rows = prioritizeCampaignLeads([
      { leadAssignmentId: "u", qualification: "UNQUALIFIED" as const, fitScore: 99, email: "u@x.io", suppressed: false, overrideReason: "ok" },
      { leadAssignmentId: "q2", qualification: "QUALIFIED" as const, fitScore: 70, email: "q2@x.io", suppressed: false },
      { leadAssignmentId: "q1", qualification: "QUALIFIED" as const, fitScore: 90, email: "q1@x.io", suppressed: false },
      { leadAssignmentId: "n", qualification: "NOT_SCORED" as const, fitScore: null, email: "n@x.io", suppressed: false, overrideReason: "ok" },
    ]);
    expect(rows.map((row) => row.leadAssignmentId)).toEqual(["q1", "q2", "u", "n"]);
  });
});

describe("deterministic content", () => {
  it("keeps weighted assignment stable across retries", () => {
    const input = {
      organizationId: "org-a",
      campaignId: "campaign-a",
      enrollmentId: "enrollment-a",
      stepId: "step-a",
      variants: [{ id: "A", weight: 70 }, { id: "B", weight: 30 }],
    };
    expect(assignDeterministicVariant(input)).toEqual(assignDeterministicVariant(input));
  });

  it("supports Liquid defaults and deterministic nested spintax", async () => {
    const rendered = await renderCampaignTemplate({
      template: "Hi {{ first_name | default: 'there' }}, {hello|welcome} to {A|{B|C}}",
      context: { first_name: "" },
      seed: "stable-seed",
    });
    expect(rendered).toContain("Hi there,");
    expect(rendered).toBe(
      await renderCampaignTemplate({
        template: "Hi {{ first_name | default: 'there' }}, {hello|welcome} to {A|{B|C}}",
        context: { first_name: "" },
        seed: "stable-seed",
      })
    );
    expect(renderDeterministicSpintax("{one|two}", "x")).toBe(
      renderDeterministicSpintax("{one|two}", "x")
    );
  });

  it("cannot load filesystem partials", async () => {
    await expect(
      renderCampaignTemplate({
        template: "{% include '/etc/passwd' %}",
        context: {},
        seed: "x",
      })
    ).rejects.toBeInstanceOf(CampaignRenderError);
  });
  it("blocks unresolved required variables", async () => {
    await expect(
      renderCampaignTemplate({
        template: "Hello {{ custom.segment }}",
        context: { custom: {} },
        requiredVariables: ["custom.segment"],
        seed: "x",
      })
    ).rejects.toBeInstanceOf(CampaignRenderError);
  });

  it("preserves the previous thread subject for blank follow-ups", async () => {
    const snapshot: V2EnrollmentRenderSnapshotV1 = {
      schemaVersion: "v2.enrollment-snapshot.v1",
      recipientEmail: "lead@example.com",
      timezone: "UTC",
      mergeData: {
        schemaVersion: "v2.outreach-profile.v1",
        predefined: { company: "TeleStar" },
        custom: {},
      },
    };
    const message = await prepareCampaignStepMessage({
      organizationId: "org",
      campaignId: "campaign",
      enrollmentId: "enrollment",
      stepId: "step-2",
      snapshot,
      variants: [{ id: "variant", weight: 100, subjectTemplate: "", bodyTemplate: "Hi {{ company }}", requiredVariables: ["company"] }],
      previousSubject: "Original subject",
    });
    expect(message.subject).toBe("Original subject");
    expect(message.body).toBe("Hi TeleStar");
    expect(message.variantId).toBe("variant");
  });
});

describe("IANA campaign scheduling", () => {
  it("uses the DST-aware spring-forward offset", () => {
    const sunday: V2CampaignScheduleV1 = {
      ...weekdaySchedule,
      weekdays: [7],
      startLocalTime: "09:00",
      endLocalTime: "10:00",
    };
    const next = nextCampaignWindow(
      new Date("2026-03-08T12:30:00.000Z"),
      sunday,
      "America/New_York"
    );
    expect(next.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("treats the after-midnight portion as the previous weekday window", () => {
    const overnight: V2CampaignScheduleV1 = {
      ...weekdaySchedule,
      weekdays: [5],
      startLocalTime: "22:00",
      endLocalTime: "02:00",
    };
    expect(
      isWithinCampaignWindow(
        new Date("2026-06-20T05:00:00.000Z"),
        overnight,
        "America/New_York"
      )
    ).toBe(true);
  });

  it("falls back lead to campaign to organization to UTC", () => {
    expect(
      resolveCampaignTimezone({
        mode: "LEAD",
        leadTimezone: "invalid/timezone",
        campaignTimezone: "Asia/Ho_Chi_Minh",
        organizationTimezone: "Europe/London",
      })
    ).toBe("Asia/Ho_Chi_Minh");
    expect(resolveCampaignTimezone({ mode: "ORGANIZATION" })).toBe("UTC");
  });
});
describe("campaign lifecycle idempotency", () => {
  it("pauses and resumes once while deduplicating audit retries", async () => {
    const audits: Array<{ eventKind: string; idempotencyKey: string }> = [];
    const enrollment = {
      id: "enrollment-1",
      status: "ACTIVE",
      timezoneSnapshot: "Asia/Ho_Chi_Minh",
      nextStepAt: new Date("2026-06-19T00:00:00.000Z"),
    };
    const campaign = {
      id: "campaign-1",
      status: "ACTIVE",
      scheduleJson: weekdaySchedule,
      timezoneMode: "LEAD",
      fallbackTimezone: "UTC",
    };
    const tx = {
      $executeRawUnsafe: vi.fn(async () => 1),
      v2Sequence: {
        findFirst: vi.fn(async () => ({ ...campaign })),
        updateMany: vi.fn(async ({ data }: { data: { status: string } }) => {
          campaign.status = data.status;
          return { count: 1 };
        }),
      },
      v2SequenceEnrollment: {
        updateMany: vi.fn(async ({ data }: { data: { status: string; nextStepAt?: Date } }) => {
          enrollment.status = data.status;
          if (data.nextStepAt) enrollment.nextStepAt = data.nextStepAt;
          return { count: 1 };
        }),
        findMany: vi.fn(async () =>
          enrollment.status === "PAUSED"
            ? [{ id: enrollment.id, timezoneSnapshot: enrollment.timezoneSnapshot }]
            : []
        ),
      },
      v2OutreachAuditEvent: {
        findFirst: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
          audits.find((audit) => audit.idempotencyKey === where.idempotencyKey) ?? null
        ),
        create: vi.fn(async ({ data }: { data: { eventKind: string; idempotencyKey: string } }) => {
          audits.push(data);
          return data;
        }),
      },
    };
    const db = { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) };
    const { pauseCampaign, resumeCampaign } = await import("../campaignRuntime");
    const common = {
      organizationId: "org-1",
      campaignId: campaign.id,
      actorUserId: "user-1",
      idempotencyKey: "request-1",
      now: new Date("2026-06-19T20:00:00.000Z"),
    };

    expect(await pauseCampaign(db as never, common)).toEqual({ changed: true, status: "PAUSED" });
    expect(await pauseCampaign(db as never, common)).toEqual({ changed: false, status: "PAUSED" });
    expect(audits.filter((audit) => audit.eventKind === "campaign.paused")).toHaveLength(1);

    expect(await resumeCampaign(db as never, common)).toMatchObject({ changed: true, resumedEnrollments: 1 });
    expect(await resumeCampaign(db as never, common)).toMatchObject({ changed: false, resumedEnrollments: 0 });
    expect(audits.filter((audit) => audit.eventKind === "campaign.resumed")).toHaveLength(1);
    expect(enrollment.status).toBe("ACTIVE");
    expect(enrollment.nextStepAt.getTime()).toBeGreaterThanOrEqual(common.now.getTime());
  });
});