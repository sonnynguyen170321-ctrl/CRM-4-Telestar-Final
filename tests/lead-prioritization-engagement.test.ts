import { beforeEach, describe, expect, it, vi } from "vitest";

const leadFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findMany: (...args: unknown[]) => leadFindMany(...args) } },
}));
vi.mock("@/lib/auth", () => ({
  getLeadWhereScope: vi.fn().mockResolvedValue({ assignedToId: "sdr-1" }),
}));

import { rankLeads } from "@/lib/leads/prioritization";

const user = {
  id: "sdr-1",
  tenantId: "tenant-1",
  role: "sdr",
} as Parameters<typeof rankLeads>[0];

function lead(
  id: string,
  input: { opens?: number; replies?: number; meetings?: number },
) {
  return {
    id,
    firstName: "Test",
    lastName: id,
    company: "Acme",
    title: "CEO",
    email: `${id}@acme.test`,
    phone: null,
    linkedIn: null,
    whatsApp: null,
    stage: "new",
    crmPriorityScore: "cold",
    source: "test",
    tags: [],
    lastContactedAt: null,
    createdAt: new Date("2026-09-01"),
    sequenceId: null,
    emailOpenCount: input.opens ?? 0,
    emailReplyCount: input.replies ?? 0,
    activities: [],
    tasks: [],
    meetings: Array.from({ length: input.meetings ?? 0 }, (_, index) => ({
      id: `m-${index}`,
    })),
  };
}

describe("lead prioritization uses execution engagement", () => {
  beforeEach(() => leadFindMany.mockReset());

  it("loads engagement counters and ranks meeting over reply over opens over cold", async () => {
    leadFindMany.mockResolvedValue([
      lead("cold", {}),
      lead("warm", { opens: 4 }),
      lead("reply", { replies: 1 }),
      lead("meeting", { meetings: 1 }),
    ]);

    const result = await rankLeads(user, { tenantId: "tenant-1" });

    expect(result.map((row) => [row.leadId, row.score, row.label])).toEqual([
      ["meeting", 100, "hot"],
      ["reply", 80, "hot"],
      ["warm", 40, "warm"],
      ["cold", 0, "cold"],
    ]);
    expect(leadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          meetings: { select: { id: true } },
        }),
      }),
    );
  });
});
