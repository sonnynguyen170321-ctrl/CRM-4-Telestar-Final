import { describe, expect, it } from "vitest";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";

import {
  clearIcpDraft,
  loadIcpDraft,
  saveIcpDraft,
  shouldPersistIcpDraft,
} from "@/lib/leadgen/icpDraftRecovery";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("ICP draft route-navigation recovery", () => {
  it("restores unsaved rules after the panel unmounts and remounts", () => {
    const session = new MemoryStorage();
    const rules = emptyIcpRulesV2("profile-a", "Profile A");
    rules.geography.targetCountries = ["Vietnam"];

    // The first panel instance persists before client-side navigation unmounts it.
    saveIcpDraft(session, "version-a", "2026-09-08T01:00:00.000Z", rules);

    // A new panel instance on return to /automation restores the same draft.
    const restored = loadIcpDraft(
      session,
      "version-a",
      "2026-09-08T01:00:00.000Z",
    );
    expect(restored?.geography.targetCountries).toEqual(["Vietnam"]);
  });

  it("drops recovery data when the server version changed or the draft was saved", () => {
    const session = new MemoryStorage();
    const rules = emptyIcpRulesV2("profile-a", "Profile A");
    saveIcpDraft(session, "version-a", "old-revision", rules);

    expect(loadIcpDraft(session, "version-a", "new-revision")).toBeNull();

    saveIcpDraft(session, "version-a", "new-revision", rules);
    clearIcpDraft(session, "version-a");
    expect(loadIcpDraft(session, "version-a", "new-revision")).toBeNull();
  });

  it("never persists profile A state under profile B during a route transition", () => {
    expect(shouldPersistIcpDraft(true, "version-a", "version-b")).toBe(false);
    expect(shouldPersistIcpDraft(true, "version-b", "version-b")).toBe(true);
    expect(shouldPersistIcpDraft(true, "", "version-b")).toBe(false);
    expect(shouldPersistIcpDraft(false, "version-b", "version-b")).toBe(
      false,
    );
  });
});
