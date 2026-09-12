import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";

const db = vi.hoisted(() => ({
  icpProfile: {
    count: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  icpVersion: {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  campaign: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  assignCampaignIcp,
  createIcpProfile,
  cloneIcpVersionAsDraft,
  publishIcpDraft,
  saveIcpDraft,
} from "@/lib/leadgen/icpAuthoring";

const tenantId = "tenant-a";
const validRules = () => {
  const rules = emptyIcpRulesV2("rules", "Software buyers");
  rules.industry.mode = "allowlist";
  rules.industry.targetIndustries = ["software"];
  return rules;
};

describe("ICP authoring persistence safety", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(
      async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
    );
  });

  it("retries a serializable conflict so only one default decision wins", async () => {
    db.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce(
        async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
      );
    db.icpProfile.count.mockResolvedValue(0);
    db.icpProfile.updateMany.mockResolvedValue({ count: 0 });
    db.icpProfile.create.mockResolvedValue({
      id: "profile-a",
      name: "First ICP",
      isDefault: true,
    });
    db.icpVersion.create.mockResolvedValue({
      id: "v1",
      versionNumber: 1,
      status: "draft",
      updatedAt: new Date(),
    });

    await expect(
      createIcpProfile({ tenantId, name: "First ICP" }),
    ).resolves.toMatchObject({
      profile: { id: "profile-a", isDefault: true },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
  it("requires explicit acknowledgement before simplifying legacy rules", async () => {
    const legacy = validRules();
    legacy.persona.departmentAllowlist = ["SALES"];
    db.icpVersion.findFirst
      .mockResolvedValueOnce({
        id: "published",
        icpProfileId: "profile-a",
        versionNumber: 2,
        status: "published",
        rulesJson: legacy,
      })
      .mockResolvedValueOnce(null);

    await expect(
      cloneIcpVersionAsDraft({
        tenantId,
        sourceVersionId: "published",
      }),
    ).rejects.toMatchObject({ code: "simplification_required" });
    expect(db.icpVersion.create).not.toHaveBeenCalled();

    await expect(
      saveIcpDraft({
        tenantId,
        versionId: "legacy-draft",
        expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
        rulesJson: legacy,
      }),
    ).rejects.toMatchObject({ code: "simplification_required" });
  });
  it("never updates a published version", async () => {
    db.icpVersion.findFirst.mockResolvedValue({
      id: "v1",
      status: "published",
    });

    await expect(
      saveIcpDraft({
        tenantId,
        versionId: "v1",
        expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
        rulesJson: validRules(),
      }),
    ).rejects.toMatchObject({ code: "published_immutable" });
    expect(db.icpVersion.updateMany).not.toHaveBeenCalled();
  });

  it("uses optimistic concurrency when saving a draft", async () => {
    db.icpVersion.findFirst.mockResolvedValue({ id: "v2", status: "draft" });
    db.icpVersion.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      saveIcpDraft({
        tenantId,
        versionId: "v2",
        expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
        rulesJson: validRules(),
      }),
    ).rejects.toMatchObject({ code: "draft_conflict" });
    expect(db.icpVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "v2",
          tenantId,
          status: "draft",
          updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        }),
      }),
    );
  });

  it("publishes atomically and archives only the prior version in the same tenant", async () => {
    db.icpVersion.findFirst.mockResolvedValue({
      id: "v3",
      icpProfileId: "profile-a",
      status: "draft",
      rulesJson: validRules(),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    db.icpVersion.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    db.icpVersion.findFirstOrThrow.mockResolvedValue({
      id: "v3",
      status: "published",
    });

    await publishIcpDraft({
      tenantId,
      versionId: "v3",
      expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.icpVersion.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          tenantId,
          icpProfileId: "profile-a",
          status: "published",
          id: { not: "v3" },
        },
      }),
    );
    expect(db.icpVersion.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: "v3", tenantId, status: "draft" }),
      }),
    );
  });

  it("reuses an existing draft instead of creating another version", async () => {
    db.icpVersion.findFirst
      .mockResolvedValueOnce({
        id: "published",
        icpProfileId: "profile-a",
        versionNumber: 2,
        status: "published",
        rulesJson: validRules(),
      })
      .mockResolvedValueOnce({ id: "draft", status: "draft" });

    await expect(
      cloneIcpVersionAsDraft({
        tenantId,
        sourceVersionId: "published",
      }),
    ).resolves.toMatchObject({ id: "draft" });
    expect(db.icpVersion.create).not.toHaveBeenCalled();
  });

  it("assigns only a published ICP from the same tenant", async () => {
    db.campaign.findFirst.mockResolvedValue({
      id: "campaign-a",
      icpVersionId: null,
    });
    db.icpVersion.findFirst.mockResolvedValue(null);

    await expect(
      assignCampaignIcp({
        tenantId,
        campaignId: "campaign-a",
        icpVersionId: "foreign-or-draft",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(db.icpVersion.findFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign-or-draft",
        tenantId,
        status: "published",
      },
      select: { id: true },
    });
    expect(db.campaign.update).not.toHaveBeenCalled();
  });
});