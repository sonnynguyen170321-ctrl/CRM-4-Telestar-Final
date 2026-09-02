# V2 revalidation map

Shared read-models are rendered on multiple routes. When a mutation changes the
underlying data, it must `revalidatePath()` **every** route that renders it — not just
the page the mutation was triggered from. Missing entries = stale UI (e.g. a deleted ICP
still showing on `/v2/uploads`).

`scripts/check-v2-revalidation.mjs` encodes the rules below and fails if a listed mutation
action does not revalidate all required routes (directly or via a helper).

| Entity / read-model | Built by | Rendered on | Mutations that must revalidate all |
|---|---|---|---|
| ICP context tree (Account→Project→published ICP) | `getLeadContextOptions` (`lib/v2/crm/queryLeadWorkspace.ts`) | `/v2/uploads`, `/v2/leads`, `/v2/companies`, `/v2/icp-library` | `publishIcpDraftAction`, `deleteIcpDraftAction`, `archiveIcpProfileAction` (`app/v2/icp-library/actions.ts`) → `revalidateIcpContextSurfaces()` + `/v2/icp-library` |

Rule of thumb: if a read-model is imported by N route segments, a mutation to its entity
revalidates all N. Add a row here + a rule in the check when you introduce a new
shared read-model.
