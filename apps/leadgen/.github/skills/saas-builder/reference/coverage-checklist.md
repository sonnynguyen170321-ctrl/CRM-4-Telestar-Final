# Coverage Checklist — the completeness gate

Walk this top to bottom in Phase 2. For each pillar, write the product-specific plan into
`BUILD_PLAN.md`, or mark it **"N/A — <reason>"**. Never leave a pillar silently blank; a silent gap
is the bug you ship in month two. The right column names the guide that implements the pillar.

## 1. Tenancy & auth model
- [ ] What is the **tenant boundary**? (org / workspace / account) — the thing Org A must never see
      of Org B.
- [ ] How do users authenticate? (password, OAuth, magic link) and how are **sessions** carried?
- [ ] Where does `tenantId` come from on every request? (**the session — never a client param**)
- [ ] Roles / RBAC — who can do what.
→ `tenant-spine.md`, `invariants.md` (#5 tenant isolation)

## 2. Data model & migrations
- [ ] The core entities and relations (from the brief), as schema models.
- [ ] Every tenant-scoped model carries the tenant FK + is indexed on it.
- [ ] Soft-delete (`deletedAt`) on anything a user can "delete".
- [ ] Audit/immutable rows where history matters (never update-in-place).
- [ ] Migration-per-change discipline.
→ `schema-modeling.md`

## 3. Domain / business logic
- [ ] The core operations (the verbs) and where they live (pure functions, not in routes).
- [ ] Validation + invalid-state-unrepresentable via types.
- [ ] Idempotency for anything that can be retried or replayed.
→ `tenant-spine.md`, `invariants.md` (#4 immutability, #6 idempotency)

## 4. Async jobs & scheduling
- [ ] What work happens **off the request** (imports, enrichment, email, exports, read-model
      refresh)?
- [ ] Queue + worker, with a **no-Redis fallback** for local dev.
- [ ] Idempotency keys / content hashes (not filenames).
- [ ] Retry policy + failure handling.
→ `job-engine.md`

## 5. API wiring
- [ ] **Reads** → tenant-scoped **read-models** (query functions), never ad-hoc queries in
      components.
- [ ] **Writes** → server actions (mutations from UI) or route handlers (webhooks, machine callers).
- [ ] Every read/write filters `deletedAt IS NULL` and scopes by tenant.
→ `api-wiring.md`

## 6. UI surfaces & navigation
- [ ] The must-have surfaces from the brief, each as one composed page.
- [ ] Shared primitives: list surface (table + filters), app shell/nav, forms, drawers.
- [ ] Loading / empty / error states for every surface.
- [ ] Theming (light + dark), accessibility (WCAG AA).
→ `ui-kit.md`

## 7. Access control / RBAC
- [ ] Permission checks at the choke-point (not sprinkled in UI).
- [ ] Role → capability mapping enforced server-side.
→ `tenant-spine.md` (`requirePermission`)

## 8. Soft-delete & audit
- [ ] `deletedAt` respected on **every** read (leads, lists, dashboards, exports, activity).
- [ ] No hard-deletes of core records in normal flows.
- [ ] Audit trail for sensitive state changes.
→ `invariants.md` (#8)

## 9. Secrets & webhooks
- [ ] Provider credentials stored **encrypted**, never logged.
- [ ] Inbound webhooks **verify signatures** before acting; unsigned = rejected.
→ `invariants.md` (#9)

## 10. Notifications / email + suppression
- [ ] Outbound email/notification path.
- [ ] **Suppression check immediately before every send** — no flag or fast-path skips it.
→ `invariants.md` (#10)

## 11. Observability & health
- [ ] `/api/health` (DB ping) as the deploy/healthcheck gate.
- [ ] Worker heartbeat / liveness.
- [ ] Structured logs; no secrets in logs.
→ `deploy-ec2.md`, `job-engine.md`

## 12. Deploy & env
- [ ] Where it runs; one image, multiple commands (web/worker/scheduler).
- [ ] Env strategy (build-time public vars vs runtime secrets).
- [ ] TLS, DNS, migrations-before-serve.
→ `deploy-ec2.md`

## 13. Seed / provisioning
- [ ] How the first tenant + admin user is created (no chicken-and-egg).
- [ ] Idempotent provisioning script.
→ `tenant-spine.md` (`scripts/v2-signup.mjs`)

## 14. Tests / exit-gates
- [ ] Each behavior (idempotency, tenant isolation, transition validity, suppression) has an
      automated check.
- [ ] Typecheck + build gate green.
- [ ] Tests are part of each session's exit-gate, not an afterthought.
→ `invariants.md` (#13), `session-decomposition.md`

---

**Identity normalization** (cross-cutting): if the product matches entities by name (companies,
people, places), normalize Unicode (NFC), strip diacritics for comparison, and handle
locale-specific legal prefixes/casing. Wrong normalization creates duplicate or merged records.
→ `invariants.md` (#11)
