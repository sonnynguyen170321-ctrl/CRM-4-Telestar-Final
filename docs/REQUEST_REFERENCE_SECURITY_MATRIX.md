# Request-reference security matrix

Implementation-owned control file for Wave 3. Tracks every **request-controlled relational ID**
on a write route: who may name it, whether it is tenant-safe, whether the hierarchy it implies is
consistent, and what proves it.

The independent acceptance matrix (`docs/ALL_GREEN_ACCEPTANCE_MATRIX.md`) is maintained by the
auditor and is **not** edited from here.

## Rules of evidence

A row is GREEN only when a test executed against the route reproduces the refusal *and* a
positive control proves the endpoint still works. Reading the source is a hypothesis; the Lead
finding was real and the booking-link `isDefault` finding was not, and only measurement told them
apart.

Response convention, established by `tenant-isolation.spec.ts` and followed since:

| condition | status |
|---|---|
| referenced row in another tenant | 404 — foreign existence must not be confirmable |
| referenced row does not exist | 404 — indistinguishable from the above |
| in-tenant, caller not authorized | 403 — the caller may know it exists |
| structurally inconsistent hierarchy | 400/422 — not 403; the caller has access to both objects |
| authorized | success |

## Fixture rule — read before writing any cross-tenant test

`lib/tenant-inject.ts` `applyScopedTenant()` makes the **active context tenant win** over
`data.tenantId`. Creating a "tenant B" row while tenant-A context is active silently produces a
**tenant-A** row.

This invalidated a probe and produced a false cross-tenant finding. Multi-tenant fixtures must
either run each side inside its own tenant context, or be built with raw SQL — and must assert
`tenantId` immediately after setup, before any request.

## Matrix

| Route | Method | Field | Model | Tenant | Object auth | Parent consistent | Cross-tenant | Same-tenant unauth | Missing id | Partial write | Concurrency | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/leads` | POST | `tenantId` | — | ignored, session wins | n/a | n/a | ✅ | n/a | n/a | ✅ | n/a | **GREEN** | `5d6eadf` |
| `/api/leads` | POST | `assignedToId` | User | via `canAccessUser` | ✅ 403 | n/a | ✅ | ✅ | — | ✅ | n/a | **GREEN** | `5d6eadf` |
| `/api/leads` | POST | `campaignId` | Campaign | `canReferenceCampaign` | ✅ 403 | — | ✅ 404 | ✅ 403 | ✅ 404 | ✅ | n/a | **GREEN** | `5d6eadf` |
| `/api/work-orders` | POST | `leadId` | Lead | `resolveScope` | ❌ **open** | n/a | ✅ | ❌ | ✅ | ✅ | n/a | **YELLOW** | `5d6eadf` |
| `/api/work-orders` | POST | `campaignId` | Campaign | `resolveScope` | ❌ **open** | n/a | ✅ | ❌ | ✅ | ✅ | n/a | **YELLOW** | `5d6eadf` |
| `/api/work-orders` | POST | `tenantId`, `createdById` | — | ignored, session wins | n/a | n/a | ✅ | n/a | n/a | ✅ | n/a | **GREEN** | `5d6eadf` |
| `/api/work-orders/[id]/dispatch` | POST | order target | Lead / Campaign | `assertActorMayDispatch` | ✅ 403 | n/a | ✅ | ✅ | ✅ | ✅ no job, no lease | n/a | **GREEN**, audit pending | `5d6eadf` |
| `/api/work-orders` | GET | — | — | tenant only | ❌ unscoped | n/a | — | recorded | — | n/a | n/a | **YELLOW** | `5d6eadf` |
| `/api/booking-links` | POST | `clientId` | Client | `canReferenceClient` | ✅ 403 | ✅ 422 | ✅ 404 | ✅ 403 | ✅ 404 | ✅ | n/a | **GREEN** | `f8c635f` |
| `/api/booking-links` | POST | `campaignId` | Campaign | `canReferenceCampaign` | ✅ 403 | ✅ 422 | ✅ 404 | ✅ 403 | ✅ 404 | ✅ | n/a | **GREEN** | `f8c635f` |
| `/api/booking-links` | POST | `tenantId`, `createdById` | — | ignored, session wins | n/a | n/a | ✅ | n/a | n/a | ✅ | n/a | **GREEN** | `f8c635f` |
| `/api/booking-links` | POST | `isDefault` clear | BookingLink | ✅ scoped by extension | n/a | n/a | ✅ **proven** | n/a | n/a | ✅ | ✅ advisory lock | **GREEN** | `HEAD` |
| `/api/booking-links` | GET | `client`, `campaign`, `createdBy` includes | Client / Campaign / User | ✅ relation guard | n/a | n/a | ✅ **was RED** | n/a | n/a | n/a | n/a | **GREEN** | `HEAD` |
| `/api/client-reports` | POST | `clientId` | Client | `canReferenceClient` | ✅ 403 | ✅ 422 | ✅ 404 | ✅ 403 | ✅ 404 | ✅ | n/a | **GREEN** | `HEAD` |
| `/api/client-reports` | POST | `campaignId` | Campaign | `canReferenceCampaign` | ✅ 403 | ✅ 422 | ✅ 404 | ✅ 403 | ✅ 404 | ✅ | n/a | **GREEN** | `HEAD` |
| `/api/client-reports` | POST | `tenantId`, `generatedById` | — | ignored, session wins | n/a | n/a | ✅ | n/a | n/a | ✅ | n/a | **GREEN** | `HEAD` |
| `/api/sequences/preview` | POST | `sequenceId`, `leadId` | — | not dereferenced | n/a | n/a | — | — | — | — | n/a | **PENDING** | — |

## Booking links — raw-SQL probe, classification B

Fixtures built with `psql`, measurements read with `psql`, so the tenant extension influenced
neither setup nor observation.

Precondition (asserted before the request):

```
 blsql-link-a | blsql-ta | blsql-client-a | blsql-camp-a | t
 blsql-link-b | blsql-tb | blsql-client-b | blsql-camp-b | t
```

Tenant-A floor manager POSTs tenant-B `clientId` + `campaignId`, `isDefault: true` → **201**.

After:

```
 blsql-link-a              | blsql-ta | blsql-client-a | blsql-camp-a | t |
 blsql-link-b              | blsql-tb | blsql-client-b | blsql-camp-b | t |
 cmsu172l50001vwbkdmvlwa8n | blsql-ta | blsql-client-b | blsql-camp-b | t | blsql-fm-a
```

**Classification B.** `blsql-link-b` is unchanged — still tenant B, still default. The
`updateMany` **is** tenant-scoped by `applyScopedTenant`; there is no cross-tenant bulk-write
defect, and none is being fixed. The earlier contrary observation was the fixture rule above.

The new row is tenant A pointing at tenant-B client *and* campaign: reference-integrity RED,
proven in isolation.

### Disclosure, from the same evidence

The 201 body returned foreign tenant data:

```json
"client":{"id":"blsql-client-b","name":"Client B"},
"campaign":{"id":"blsql-camp-b","name":"Camp B"}
```

The route `include`s the relations it just attached, so POST already discloses another tenant's
client and campaign names. Validating POST closes this path; historical poisoned rows would still
leak through GET, so the read-side test and the integrity diagnostic are still required.

## Booking-link default concurrency — DATA-INTEGRITY RED, reproduced

Two simultaneous authorized `isDefault: true` POSTs for one client+campaign scope, eight rounds:

```
defaults per scope after each round: [1, 2, 2, 2, 2, 2, 2, 2]
```

**Seven of eight rounds ended with two defaults.** Not a rare interleaving — the default path is
`updateMany` (clear) then `create`, two separate writes with nothing behind them, so both requests
clear and then both create. Afterwards, which link a prospect is sent to depends on row ordering.

The reproduction lives in `tests/booking-link-reference-integrity.test.ts` and is **deliberately
uncommitted** while red, so CI is not broken by a known-open finding.

### Fixed with a transaction-scoped advisory lock

Three designs were considered; two were ruled out on evidence rather than taste.

A **partial unique index** would need `COALESCE("campaignId", '')`, because `campaignId` is
nullable and Postgres treats `NULL != NULL` — a plain unique index would not constrain the
campaign-less scope at all. Prisma's `@@unique` cannot express a functional or partial index, so
that lands as a **migration-only constraint**, which `CLAUDE.md` forbids: it disappears the next
time a migration is generated from the datamodel.

**Interactive transactions** were the open question, since the runtime rules note that the Neon
HTTP driver has none. Settled by inspection rather than assumption: `package.json` carries no
Neon, adapter or serverless dependency, and `lib/prisma.ts:57` builds a standard `PrismaClient`
over TCP. Interactive transactions are available on this path. The Neon note describes a possible
future deployment, not the current one — worth re-checking if that changes.

So: `pg_advisory_xact_lock(hashtext(scope))` inside a `$transaction`, keyed on
`tenant:client:campaign`. No schema change, nothing to drift, transaction-scoped so it releases
on commit or rollback with no unlock path to forget, and it serializes one scope rather than the
table.

Result on the same test that failed seven of eight rounds: **24 concurrency rounds across three
runs, every round ending with exactly one default.**

`tenantId` is now also stated explicitly on the create. Inside `$transaction`, `tx` is the raw
client rather than the `TenantOptionalClient` wrapper, so the type system requires it — and on a
row whose entire purpose is client scoping, saying it out loud is an improvement.

## Booking-link GET disclosure — was RED, fixed

A separate defect from the write path, and one that survives it. The root `BookingLink` is
tenant-scoped by the extension, but a to-one relation reached through `include` is not — the
`include` follows the foreign key wherever it points.

Seeded a poisoned row with raw SQL (tenant A row, tenant B client and campaign — a shape POST can
no longer produce), then listed as tenant A. The response carried tenant B's **client name**.

Fixed by selecting `tenantId` on each included relation and withholding any that does not match
the viewer. The relation is withheld rather than the row: the BookingLink belongs to this tenant,
and hiding it would make a real record invisible with no way to notice. `null` is already the
shape callers handle, since `campaign` and `createdBy` are optional — so this degrades to
"unknown", not to a lie.

This closes disclosure for historical rows without depending on a data repair.

## Read-only integrity diagnostic

`scripts/check-relational-integrity.ts` (`npm run check:relational-integrity`, `--json` for
machine output, exit 1 on any finding) answers the question the two write fixes cannot: whether
rows written *before* them already carry a poisoned reference.

Four checks — `Lead -> Campaign` tenancy, `BookingLink -> Client` tenancy, `BookingLink ->
Campaign` tenancy, and the `campaign.clientId != clientId` hierarchy mismatch, which is not a
tenancy fault at all.

It reports ids and tenant ids only. **No repair, no deletion, no reassignment** — deciding which
side of a poisoned reference is correct needs someone who knows the data, and an automatic fix
could quietly move a real client's booking link to the wrong company.

Proven against a live database rather than asserted: on first run it found **4 real inconsistent
rows** — leftovers from the discarded classification probe — printed them with their tenant ids,
and exited 1. After those rows were removed it reports 0 and exits 0.

## Client reports — was RED across the board, fixed

`canCreateClientReport` admits **sdr** upward, so the widest exposure was an ordinary rep, and
`clientId` / `campaignId` arrived unvalidated in the body. Measured before changing anything:

    foreign client            201  ->  404
    foreign campaign          201  ->  404
    nonexistent client        500  ->  404
    nonexistent campaign      500  ->  404
    in-tenant invisible client    201  ->  403
    in-tenant invisible campaign  201  ->  403
    campaign of another client    201  ->  422

Worse than the booking-link shape in one respect, which is why the checks run *before*
`buildReportMetrics`: that call computes aggregates over whatever client was named, so an
unchecked foreign reference does not merely mislabel a row — it pulls another tenant's numbers
into the stored snapshot and the response. Every negative case asserts the response body carries
no foreign identifier, not just that the status is right.

`tenantId` and `generatedById` were already session-derived and remain so.

## Open work, in order

1. **Booking links** — repair the fixture (per-tenant contexts + post-setup `tenantId`
   assertions, extracted as a shared helper); complete the 10-case matrix; add the hierarchy case
   (`campaign.clientId == body.clientId`, 400/422); derive the Floor Manager **client** visibility
   contract from existing client pages/APIs/tests *before* writing `canReferenceClient`; validate
   everything before the default-clear and the create; explicit `tenantId` on the `updateMany` as
   **defence in depth only**, not as a fix for a proven bug; partial-write snapshots for every
   refusal; concurrency rounds asserting exactly one default per scope (mind Postgres `NULL`
   semantics if a unique index is chosen); poisoned-row GET disclosure; read-only integrity
   diagnostic.
2. **Client reports** — `clientId`, `campaignId`, `generatedById`, `approvedById`, owner,
   `tenantId`, recipient, share token; token unguessability, cross-report reuse, revocation only
   if the product already claims it.
3. **Work order CREATE object RBAC** — regressions first. An SDR creating a draft against a
   hidden peer lead is an existence oracle, durable clutter, and an order another actor may later
   dispatch. Do not treat the current implementation as the specification; if the contract says
   only callers who may act on the target may create, reuse `canAccessLead` /
   `canReferenceCampaign` at the create boundary rather than inventing a second model.
4. **Sequence preview** — one test proving `sequenceId` / `leadId` are opaque seed inputs: no row
   read, no metadata returned, no writes. Then record as "not dereferenced". Do not add
   authorization that protects no data.
5. **Reconcile all 21** request-controlled relational-ID routes from the independent inventory.
   Every one must resolve to: validated at route · validated by delegated domain service ·
   server-derived · opaque · fixed vulnerability · or intentional with contract evidence. Verify
   delegation for `tasks`, `admin/transfer-work`, `campaigns/[id]/members`, `demo/inbound-reply`
   rather than adding duplicate route-level checks.
6. **Name the 5 skipped tests** in the final certificate — file, test, skip condition, and why CI
   does or does not execute them. No required integration coverage may vanish by host config.

## Freeze preconditions

Booking links complete · client reports complete · work-order CREATE classified or fixed ·
dispatch green · sequence preview classified · all 21 rows accounted for · this matrix complete ·
working tree clean · exact-head CI green. Then one 40-character SHA to the auditor, which does
not move.
