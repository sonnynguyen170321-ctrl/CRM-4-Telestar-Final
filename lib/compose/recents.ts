/**
 * "Recently used" ids for the template and snippet pickers, kept in the browser. Per device and per
 * user is enough: it only orders a list, and a missing or stale id is simply skipped.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_RECENT = 5;

export function readRecentIds(store: KeyValueStore | null, key: string): string[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Put `id` first, drop its earlier position, keep the newest few. Returns the new list. */
export function pushRecentId(store: KeyValueStore | null, key: string, id: string): string[] {
  const next = [id, ...readRecentIds(store, key).filter((existing) => existing !== id)].slice(0, MAX_RECENT);
  try {
    store?.setItem(key, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the list just is not remembered.
  }
  return next;
}

/** Items in recency order first (those whose id is in `recentIds`), then the rest as given. */
export function orderByRecent<T extends { id: string }>(items: readonly T[], recentIds: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const recent = recentIds.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
  const recentSet = new Set(recent.map((item) => item.id));
  return [...recent, ...items.filter((item) => !recentSet.has(item.id))];
}
