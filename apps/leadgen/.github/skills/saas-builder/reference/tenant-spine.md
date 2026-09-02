# Tenant Spine — auth + tenant isolation + prisma

The spine every multi-tenant SaaS needs before any feature: authenticate a user, resolve *which
tenant* they act in, and make every DB call go through one tenant-scoped client. Reference
implementation: **TeleStar V2** — read these files, don't reinvent.

## Prisma driver-adapter singleton

`lib/server/prisma.ts`:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
```

One singleton, reused across the process (guard with `globalForPrisma` so dev hot-reload doesn't
open a new pool each time). Everything imports `@/lib/server/prisma`. This is the **only** allowed
shared infra — it must never become a backdoor to another system's tables.

**RDS SSL gotcha** (paid for, see `deploy-ec2.md`): the `pg` adapter needs `sslmode=no-verify` in
the URL against RDS's Amazon CA; the migrate engine wants `sslmode=require`. Two libs, two
semantics.

## Password auth — scrypt + pepper

`lib/v2/auth/password.ts` — `hashPassword` / `verifyPassword`:

- **scrypt** (built-in `node:crypto`, no dependency) with a per-user random salt.
- A server-wide **pepper** from `V2_AUTH_SECRET` mixed in — so a stolen DB alone can't be
  brute-forced offline. The same secret must exist wherever you hash *and* verify.
- Stored as `scrypt$<salt>$<key>`; verify with `timingSafeEqual`.

## Sessions — opaque token, hashed at rest

`lib/v2/auth/session.ts`:

- `createAuthSession({ userId })` — mint a random token, store only its **hash**
  (`hashSessionToken`), set an **httpOnly, secure** cookie.
- `readAuthSessionToken()` / `getCurrentAuthIdentity()` — resolve the current user from the cookie.
- `revokeCurrentAuthSession()` / `clearAuthCookie()` — logout.
- `requireAuthSecret()` — fail loudly if `V2_AUTH_SECRET` is missing.

Never store the raw token; a DB leak then can't be replayed as a live session.

## Tenant isolation — one choke-point

`lib/v2/tenant/requireTenantContext.ts` is the single function every server action / read-model /
route calls first:

```ts
const ctx = await requireTenantContext();   // { organizationId, userId, role, ... }
// ...every query below is scoped by ctx.organizationId
```

- It resolves the authenticated identity → the user → their **ACTIVE membership in an ACTIVE org**,
  and returns `organizationId` **from the session**. 
- **The tenant id NEVER comes from a client parameter.** That is the whole ballgame (invariant #5).
- `requirePermission(ctx, permission)` (same module) enforces RBAC at the choke-point, not in the
  UI.

Rule: if a query isn't scoped by the context's `organizationId`, it's a cross-tenant bug. Add a
tenant-isolation test as the exit-gate for every new read-model.

## Provisioning — no chicken-and-egg

`scripts/v2-signup.mjs` creates the first org + user + membership + credential in **one idempotent
transaction** (upserts keyed by content, re-runnable). Run it inside the app image so it shares the
same `DATABASE_URL` + `V2_AUTH_SECRET` (so the hash verifies at login). This is how you bootstrap an
admin before any UI exists.

## Session fit

The spine is usually the **first cluster** in the build queue: a `schema` session (Org/User/
Membership/Session/Credential models) → the auth lib + `requireTenantContext` (an `api`-ish
foundation session) → the provisioning script. Everything else `consumes` this.
