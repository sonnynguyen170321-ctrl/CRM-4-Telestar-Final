import { describe, expect, it } from "vitest";

import { archiveCampaign, deleteCampaign, renameCampaign, type CampaignLifecycleDb } from "../campaignLifecycle";

// Locks the lifecycle status rules with a minimal fake db: archive blocked while ACTIVE,
// delete only from DRAFT/ARCHIVED, rename validates input, everything audited + org-scoped.

type Row = { id: string; organizationId: string; status: string; deletedAt: Date | null; name: string };

function fakeDb(rows: Row[]) {
  const audits: unknown[] = [];
  const db = {
    v2Sequence: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        rows.find((r) => r.id === where.id && r.organizationId === where.organizationId && r.deletedAt === null) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; organizationId: string }; data: Partial<Row> }) => {
        const hits = rows.filter((r) => r.id === where.id && r.organizationId === where.organizationId && r.deletedAt === null);
        for (const hit of hits) Object.assign(hit, data);
        return { count: hits.length };
      },
    },
    $queryRawUnsafe: async (...args: unknown[]) => {
      audits.push(args);
      return [];
    },
  };
  return { db: db as unknown as CampaignLifecycleDb, rows, audits };
}

const ctx = { organizationId: "org1", actorUserId: "user1" };

describe("campaignLifecycle", () => {
  it("archive is blocked while ACTIVE and idempotent when already archived", async () => {
    const { db } = fakeDb([{ id: "c1", organizationId: "org1", status: "ACTIVE", deletedAt: null, name: "A" }]);
    expect((await archiveCampaign(db, ctx, { campaignId: "c1" })).ok).toBe(false);

    const archived = fakeDb([{ id: "c2", organizationId: "org1", status: "ARCHIVED", deletedAt: null, name: "B" }]);
    expect((await archiveCampaign(archived.db, ctx, { campaignId: "c2" })).ok).toBe(true);
  });

  it("archives a PAUSED campaign and records an audit", async () => {
    const { db, rows, audits } = fakeDb([{ id: "c1", organizationId: "org1", status: "PAUSED", deletedAt: null, name: "A" }]);
    const res = await archiveCampaign(db, ctx, { campaignId: "c1" });
    expect(res.ok).toBe(true);
    expect(rows[0].status).toBe("ARCHIVED");
    expect(audits.length).toBe(1);
  });

  it("delete only allows DRAFT or ARCHIVED and soft-deletes", async () => {
    const { db } = fakeDb([{ id: "c1", organizationId: "org1", status: "ACTIVE", deletedAt: null, name: "A" }]);
    expect((await deleteCampaign(db, ctx, { campaignId: "c1" })).ok).toBe(false);

    const draft = fakeDb([{ id: "c2", organizationId: "org1", status: "DRAFT", deletedAt: null, name: "B" }]);
    expect((await deleteCampaign(draft.db, ctx, { campaignId: "c2" })).ok).toBe(true);
    expect(draft.rows[0].deletedAt).toBeInstanceOf(Date);
  });

  it("rename validates and is tenant-scoped (wrong org = not found)", async () => {
    const { db } = fakeDb([{ id: "c1", organizationId: "OTHER", status: "DRAFT", deletedAt: null, name: "A" }]);
    expect((await renameCampaign(db, ctx, { campaignId: "c1", name: "New" })).ok).toBe(false);
    const mine = fakeDb([{ id: "c2", organizationId: "org1", status: "DRAFT", deletedAt: null, name: "A" }]);
    expect((await renameCampaign(mine.db, ctx, { campaignId: "c2", name: "  " })).ok).toBe(false);
    expect((await renameCampaign(mine.db, ctx, { campaignId: "c2", name: "Renamed" })).ok).toBe(true);
    expect(mine.rows[0].name).toBe("Renamed");
  });
});
