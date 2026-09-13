import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/auth";
import {
  canUseResearch,
  researchQueryLimitForRole,
  researchQueryOptionsForRole,
  validateResearchQueryLimit,
} from "@/lib/research/access";

const mocks = vi.hoisted(() => ({
  createResearchRun: vi.fn(),
  requireResearchRunner: vi.fn(),
}));

vi.mock("@/app/api/research/guard", () => ({
  requireResearchRunner: mocks.requireResearchRunner,
  requireResearchUser: vi.fn(),
}));
vi.mock("@/lib/research/discovery", () => ({
  createResearchRun: mocks.createResearchRun,
}));
vi.mock("@/lib/research/readModel", () => ({
  listResearchRuns: vi.fn(),
}));

import { POST as createRun } from "@/app/api/research/runs/route";

const user = (
  role: SessionUser["role"],
  scopes?: string[],
): SessionUser => ({
  id: `${role}-1`,
  email: `${role}@example.test`,
  firstName: "Research",
  lastName: "User",
  role,
  tenantId: "tenant-a",
  ...(scopes
    ? { apiKey: { id: "key-1", name: "Integration", scopes } }
    : {}),
});

describe("research action access", () => {
  const operatorRoles: SessionUser["role"][] = [
    "sdr",
    "team_lead",
    "floor_manager",
    "director",
    "leadgen_manager",
  ];

  it("lets SDRs and managers read, run, and promote interactively", () => {
    for (const role of operatorRoles) {
      expect(canUseResearch(user(role), "read")).toBe(true);
      expect(canUseResearch(user(role), "run")).toBe(true);
      expect(canUseResearch(user(role), "promote")).toBe(true);
    }
    for (const role of ["leadgen"] as const) {
      expect(canUseResearch(user(role), "read")).toBe(false);
      expect(canUseResearch(user(role), "run")).toBe(false);
      expect(canUseResearch(user(role), "promote")).toBe(false);
    }
  });

  it("keeps destructive run management manager-only", () => {
    for (const role of ["director", "floor_manager", "leadgen_manager"] as const) {
      expect(canUseResearch(user(role), "manage")).toBe(true);
    }
    for (const role of ["sdr", "team_lead", "leadgen"] as const) {
      expect(canUseResearch(user(role), "manage")).toBe(false);
    }
  });

  it("requires explicit API-key research scopes", () => {
    expect(canUseResearch(user("director", ["leads:read"]), "read")).toBe(false);
    expect(canUseResearch(user("team_lead", ["research:read"]), "read")).toBe(true);
    expect(canUseResearch(user("team_lead", ["research:read"]), "run")).toBe(false);
    expect(canUseResearch(user("team_lead", ["research:write"]), "run")).toBe(true);
    expect(canUseResearch(user("sdr", ["research:write"]), "run")).toBe(true);
    expect(canUseResearch(user("leadgen", ["*"]), "promote")).toBe(false);
    expect(canUseResearch(user("director", ["*"]), "manage")).toBe(true);
  });
});

describe("research provider-spend cap", () => {
  it("caps contributors at 100 and managers at 1000", () => {
    expect(researchQueryLimitForRole("sdr")).toBe(100);
    expect(researchQueryLimitForRole("team_lead")).toBe(100);
    expect(researchQueryLimitForRole("leadgen")).toBe(100);
    expect(researchQueryLimitForRole("floor_manager")).toBe(1000);
    expect(researchQueryLimitForRole("director")).toBe(1000);
    expect(researchQueryLimitForRole("leadgen_manager")).toBe(1000);
    expect(researchQueryOptionsForRole("sdr")).toEqual([50, 100]);
    expect(researchQueryOptionsForRole("director")).toEqual([
      50,
      100,
      200,
      1000,
    ]);
  });

  it("rejects a direct SDR POST above the cap before creating a run", async () => {
    mocks.requireResearchRunner.mockResolvedValue(user("sdr"));
    const response = await createRun(
      new NextRequest("http://localhost/api/research/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "company",
          icpVersionId: "icp-v1",
          queryLimit: 1000,
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "research_query_limit_exceeded",
    });
    expect(mocks.createResearchRun).not.toHaveBeenCalled();
  });

  it("allows an SDR POST at the cap", async () => {
    mocks.requireResearchRunner.mockResolvedValue(user("sdr"));
    mocks.createResearchRun.mockResolvedValue({ id: "run-1", queries: 100 });
    const response = await createRun(
      new NextRequest("http://localhost/api/research/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "company",
          icpVersionId: "icp-v1",
          queryLimit: 100,
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createResearchRun).toHaveBeenCalledWith(
      expect.objectContaining({ queryLimit: 100, createdById: "sdr-1" }),
    );
  });

  it("provides a pure validator for every request path", () => {
    expect(validateResearchQueryLimit("sdr", 101)).toEqual({
      ok: false,
      max: 100,
    });
    expect(validateResearchQueryLimit("sdr", 100)).toEqual({ ok: true });
  });
});

describe("phase 2 navigation and route wiring", () => {
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");

  it("surfaces Prospecting and fixes the import deep link", () => {
    const sidebar = source("components/Sidebar.tsx");
    const manager = source("app/leadgen-manager/page.tsx");
    expect(sidebar).toContain("label: 'Prospecting'");
    expect(sidebar).toContain("href: '/research'");
    expect(sidebar).toContain("href: '/lead-filter'");
    expect(sidebar).toContain("...(isManager");
    expect(sidebar).toContain("canUseResearchRole(userRole, 'read')");
    expect(sidebar).toContain("href: '/automation?tab=scoring'");
    expect(sidebar).toContain("/leadgen-manager?tab=pool&import=1");
    expect(manager).toContain("searchParams.get('import') !== '1'");
    expect(manager).toContain("onRequestImport()");
  });

  it("wires create, execute, and promote to action-specific guards", () => {
    expect(source("components/research/ResearchWorkspace.tsx")).toContain("!canAccessResearch");
    expect(source("app/api/research/runs/route.ts")).toContain(
      "requireResearchRunner",
    );
    expect(source("app/api/research/runs/[id]/execute/route.ts")).toContain(
      "requireResearchRunner",
    );
    expect(source("app/api/research/candidates/promote/route.ts")).toContain(
      "requireResearchPromoter",
    );
    expect(source("lib/research/discovery.ts")).toContain(
      "queries = queries.slice(0, limit)",
    );
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
