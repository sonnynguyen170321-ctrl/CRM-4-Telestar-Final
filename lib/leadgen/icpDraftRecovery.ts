import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredIcpDraft = {
  expectedUpdatedAt: string;
  rules: IcpVersionRulesV2;
};

export function shouldPersistIcpDraft(
  dirty: boolean,
  rulesVersionId: string,
  activeVersionId: string,
) {
  return dirty && rulesVersionId === activeVersionId;
}

const keyFor = (versionId: string) => `telestar:icp-draft:${versionId}`;

export function saveIcpDraft(
  storage: DraftStorage,
  versionId: string,
  expectedUpdatedAt: string,
  rules: IcpVersionRulesV2,
) {
  storage.setItem(
    keyFor(versionId),
    JSON.stringify({ expectedUpdatedAt, rules } satisfies StoredIcpDraft),
  );
}

export function loadIcpDraft(
  storage: DraftStorage,
  versionId: string,
  expectedUpdatedAt: string,
): IcpVersionRulesV2 | null {
  const key = keyFor(versionId);
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as Partial<StoredIcpDraft>;
    if (
      stored.expectedUpdatedAt !== expectedUpdatedAt ||
      !stored.rules ||
      typeof stored.rules !== "object" ||
      !("schemaVersion" in stored.rules)
    ) {
      storage.removeItem(key);
      return null;
    }
    return stored.rules;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearIcpDraft(
  storage: DraftStorage,
  versionId: string,
) {
  storage.removeItem(keyFor(versionId));
}
