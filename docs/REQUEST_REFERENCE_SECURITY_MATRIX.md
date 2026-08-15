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
| `/api/booking-links` | POST | `clientId` | Client | ❌ **none** | ❌ | ❌ | ❌ **201** | — | ❌ **500** | — | — | **RED** | probe below |
| `/api/booking-links` | POST | `campaignId` | Campaign | ❌ **none** | ❌ | ❌ | ❌ **201** | — | — | — | — | **RED** | probe below |
| `/api/booking-links` | POST | `campaign.clientId == clientId` | — | n/a | n/a | ❌ **untested** | — | — | — | — | — | **RED** | — |
| `/api/booking-links` | POST | `tenantId`, `createdById` | — | ignored, session wins | n/a | n/a | ✅ | n/a | n/a | ✅ | n/a | **GREEN** | probe below |
| `/api/booking-links` | POST | `isDefault` clear | BookingLink | ✅ scoped by extension | n/a | n/a | ✅ **proven** | n/a | n/a | — | ❌ untested | **YELLOW** | probe below |
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
