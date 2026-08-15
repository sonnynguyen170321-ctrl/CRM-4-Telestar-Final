// Nested-relation tenant scoping for the Prisma client extension in `lib/prisma.ts`.
//
// The extension scopes the **top-level** operation: `applyScopedTenant` injects `tenantId` into
// the `where` of a read. A relation reached *through* that row by `include`/`select` is not
// scoped — the include follows the foreign key wherever it points. Any row whose foreign key
// crosses a tenant boundary therefore discloses the selected fields of the foreign row.
//
// Measured twice, not theorised: through `GET /api/booking-links` with a mocked session, and
// through `scripts/repro-nested-include-leak.ts` reading on the scoped path.
//
// Prisma accepts a `where` on a **to-many** include and does not on a **to-one** include, so:
//
//   to-many  -> inject `where: { tenantId }`; foreign rows never leave the database
//   to-one   -> force `tenantId` into the selection so the result can be checked, null the
//               relation when it belongs elsewhere, then remove the forced field again
//
// The relation is withheld, never the parent row: the parent belongs to this tenant, and hiding
// it would make a real record invisible with no way to notice.

export const RELATION_SCOPED_OPS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
]);

export interface RelationMeta {
  type: string;
  isList: boolean;
}

export type RelationMap = ReadonlyMap<string, ReadonlyMap<string, RelationMeta>>;

/** Build `model -> relation -> meta`, restricted to relations whose target carries a `tenantId`. */
export function buildRelationMap(
  models: readonly {
    name: string;
    fields: readonly { name: string; kind: string; type: string; isList: boolean }[];
  }[]
): RelationMap {
  const tenantOwned = new Set(
    models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name)
  );

  const map = new Map<string, Map<string, RelationMeta>>();
  for (const model of models) {
    const relations = new Map<string, RelationMeta>();
    for (const field of model.fields) {
      if (field.kind !== 'object') continue;
      if (!tenantOwned.has(field.type)) continue;
      relations.set(field.name, { type: field.type, isList: field.isList });
    }
    if (relations.size > 0) map.set(model.name, relations);
  }
  return map;
}

type ForcedPath = string[];

function selectionOf(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (obj.include && typeof obj.include === 'object') return obj.include as Record<string, unknown>;
  if (obj.select && typeof obj.select === 'object') return obj.select as Record<string, unknown>;
  return null;
}

/**
 * Make every tenant-owned relation in a query's selection checkable. Mutates `args`, matching the
 * surrounding extension's semantics. Returns the paths where a `tenantId` was **added**, so
 * `stripForcedFields` can remove exactly those and leave the response shape untouched.
 */
export function forceTenantIdOnRelations(
  model: string,
  args: unknown,
  tenantId: string,
  relationMap: RelationMap,
  path: ForcedPath = [],
  forced: ForcedPath[] = []
): ForcedPath[] {
  const selection = selectionOf(args);
  if (!selection) return forced;

  const relations = relationMap.get(model);
  if (!relations) return forced;

  for (const [key, rawValue] of Object.entries(selection)) {
    const meta = relations.get(key);
    if (!meta) continue;
    if (rawValue === false || rawValue === undefined || rawValue === null) continue;

    let node: Record<string, unknown>;
    if (rawValue === true) {
      // `true` returns every scalar, `tenantId` among them — nothing to force. A list still needs
      // an object to hang a `where` on.
      if (!meta.isList) continue;
      node = {};
      selection[key] = node;
    } else if (typeof rawValue === 'object') {
      node = rawValue as Record<string, unknown>;
    } else {
      continue;
    }

    if (meta.isList) {
      const existing = node.where as Record<string, unknown> | undefined;
      node.where = existing ? { AND: [existing, { tenantId }] } : { tenantId };
    } else {
      const select = node.select as Record<string, unknown> | undefined;
      if (select && typeof select === 'object' && select.tenantId !== true) {
        select.tenantId = true;
        forced.push([...path, key]);
      }
    }

    forceTenantIdOnRelations(meta.type, node, tenantId, relationMap, [...path, key], forced);
  }

  return forced;
}

/** Null to-one relations owned by another tenant; drop foreign entries from list relations. */
export function scrubForeignRelations<T>(
  model: string,
  result: T,
  tenantId: string,
  relationMap: RelationMap
): T {
  if (result === null || result === undefined) return result;

  if (Array.isArray(result)) {
    return result.map((row) =>
      scrubForeignRelations(model, row, tenantId, relationMap)
    ) as unknown as T;
  }
  if (typeof result !== 'object') return result;

  const relations = relationMap.get(model);
  if (!relations) return result;

  const row = result as Record<string, unknown>;
  let copy: Record<string, unknown> | null = null;

  for (const [key, meta] of relations) {
    if (!(key in row)) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;

    if (meta.isList) {
      if (!Array.isArray(value)) continue;
      const kept = value
        .filter((entry) => !isForeign(entry, tenantId))
        .map((entry) => scrubForeignRelations(meta.type, entry, tenantId, relationMap));
      if (kept.length !== value.length || kept.some((entry, i) => entry !== value[i])) {
        copy = copy ?? { ...row };
        copy[key] = kept;
      }
      continue;
    }

    if (isForeign(value, tenantId)) {
      copy = copy ?? { ...row };
      copy[key] = null;
      continue;
    }
    const scrubbed = scrubForeignRelations(meta.type, value, tenantId, relationMap);
    if (scrubbed !== value) {
      copy = copy ?? { ...row };
      copy[key] = scrubbed;
    }
  }

  return (copy ?? row) as T;
}

/**
 * A relation is foreign only when it says so. An entry whose `tenantId` was not selected cannot be
 * judged and is left alone: this layer never guesses, because nulling a legitimate relation is a
 * visible product break, while the disclosure it guards against needs a row that already points
 * across the boundary.
 */
function isForeign(value: unknown, tenantId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = (value as { tenantId?: unknown }).tenantId;
  return typeof candidate === 'string' && candidate !== tenantId;
}

/** Remove the `tenantId` values this layer forced into nested selections. */
export function stripForcedFields<T>(result: T, forced: readonly ForcedPath[]): T {
  if (forced.length === 0) return result;
  for (const path of forced) stripAt(result, path, 0);
  return result;
}

function stripAt(node: unknown, path: readonly string[], depth: number): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const entry of node) stripAt(entry, path, depth);
    return;
  }
  if (typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  const key = path[depth];
  if (key === undefined) return;
  const child = obj[key];
  if (child === null || child === undefined) return;

  if (depth === path.length - 1) {
    if (Array.isArray(child)) {
      for (const entry of child) {
        if (entry && typeof entry === 'object') delete (entry as Record<string, unknown>).tenantId;
      }
    } else if (typeof child === 'object') {
      delete (child as Record<string, unknown>).tenantId;
    }
    return;
  }
  stripAt(child, path, depth + 1);
}
