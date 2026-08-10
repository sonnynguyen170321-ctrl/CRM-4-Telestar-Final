# New Machine Setup

Canonical procedure for setting up the Telestar CRM development environment on
any computer. GitHub `main` is the single source of truth for code.

---

## Prerequisites

Choose **one** development mode. You do not need local PostgreSQL and Redis if
you are pointing at shared remote instances.

### Local-services development

| Requirement | Version |
|---|---|
| Node.js | 24.18.0 (exact — see `.nvmrc`) |
| npm | 11.16.0 (bundled with Node 24.18.0) |
| Git | any recent |
| PostgreSQL | 16 (local) |
| Redis | 7 (local) |

### Shared / demo environment development

| Requirement | Version |
|---|---|
| Node.js | 24.18.0 (exact) |
| npm | 11.16.0 |
| Git | any recent |
| Network access | to remote PostgreSQL + Redis |

No local PostgreSQL or Redis installation needed.

> **⚠ Do not accidentally mix services.** If the web app uses remote Redis
> while a local worker uses local Redis (or vice versa), jobs will silently sit
> unprocessed. Doctor reports topology; verify your worker connects to the same
> instances as the web app.

---

## Clone + Setup

```bash
git clone https://github.com/sonnynguyen170321-ctrl/CRM-4-Telestar-Final.git
cd CRM-4-Telestar-Final
npm run setup:dev
```

`setup:dev` installs dependencies, generates the Prisma client, and runs
migration preflight checks. It does **not** create `.env` or apply migrations.

---

## Provision Environment

Copy values from the team's secure secrets source (1Password / Vault / etc.)
into `.env`.

```bash
# .env.example documents every variable with explanations.
# For local-services mode:
#   DATABASE_URL and REDIS_URL point to localhost.
# For shared/demo mode:
#   They point to the team's remote instances.
```

**Do NOT copy `.env.example` directly** — it contains placeholder values, not
working credentials. `setup:dev` will never generate fake secrets or copy
placeholders for you.

---

## Verify

```bash
npm run doctor -- --require-main
```

Doctor verifies:

- Exact Node and npm versions
- Git branch + synchronization with GitHub `main`
- Dependency tree integrity
- Prisma client generated
- Database identity (`DATABASE_URL` + `DIRECT_URL` — hostname and database name only)
- Service topology (local / remote / hybrid)
- Migration status (read-only)
- Redis reachability
- Worker configuration
- Required environment variables (no secrets printed)
- Email safety (`EMAIL_SEND_DRY_RUN=true`, `SEQUENCE_AUTOSEND_ENABLED=false`)
- TypeScript compilation

### What READY means

Doctor proves that code, runtime, dependencies, configuration, schema-migration
state, and service prerequisites are aligned.

Doctor does **not** compare:

- Database contents (leads, campaigns, users, work orders)
- Redis queue contents
- Browser state
- Remote service state (external providers, OAuth tokens)

If you need data identical across machines, both computers must use the same
shared database or restore from a common snapshot.

---

## Handoff — leaving a machine

```bash
git status            # must be clean
git push              # must be pushed
git log -1 --oneline  # record what you pushed
```

Goal: working tree clean, branch pushed, GitHub contains the latest commit.

---

## Arriving on a machine

```bash
git fetch origin
git switch main
git pull --ff-only origin main
npm run doctor -- --require-main
```

If the SHA matches GitHub `main` and Doctor says READY, the machine's code,
runtime, dependencies, configuration, schema-migration state, and service
prerequisites are aligned.

---

## Feature branch development

When working on a feature branch, use Doctor without `--require-main`:

```bash
npm run doctor
```

Doctor will report that the feature branch diverges from `main` without failing
— that's expected.

---

## Troubleshooting

### Doctor reports wrong Node version

Install the exact version using your Node version manager:

```bash
nvm install 24.18.0    # or: fnm install 24.18.0
nvm use 24.18.0        # or: fnm use 24.18.0
```

### Doctor reports "remote: unavailable"

Network is unreachable. Doctor cannot verify your local HEAD matches GitHub
`main`. Ensure internet connectivity and retry.

### Doctor reports "installed tree has problems"

```bash
rm -rf node_modules
npm ci
```

### Doctor reports ACTION REQUIRED for .env

Provision environment variables from the team's secrets source. See the
"Provision Environment" section above.

### Doctor reports HYBRID TOPOLOGY

Your `DATABASE_URL`, `DIRECT_URL`, or `REDIS_URL` point to a mix of local and
remote hosts. This can be legitimate (local Redis + remote DB) but verify that
all cooperating processes (web app + worker) use the same instances.

### Doctor reports email safety failure

```bash
# In .env, ensure:
EMAIL_SEND_DRY_RUN=true
SEQUENCE_AUTOSEND_ENABLED=false
```

Both safe settings are required in development because they protect
different outbound paths. Do not enable either without an explicit
live-send decision.
