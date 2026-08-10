# Local setup — this machine

Copy to `docs/LOCAL_SETUP.md` (gitignored) and record how **your** machine is wired.

```bash
cp docs/LOCAL_SETUP.example.md docs/LOCAL_SETUP.md
```

## Why this file exists rather than a section in CLAUDE.md

`CLAUDE.md` used to state machine-specific facts as if they were universal — which Postgres
install you have, whether a `.env` exists, what the shadow database is called. Whoever edited it
described the machine they were sitting at, so it was accurate for one machine and wrong for the
other. It accumulated three separate "an earlier note here claimed X — that was wrong"
corrections from exactly this.

Documentation cannot fix that, because the facts genuinely differ. So `CLAUDE.md` now holds only
what is true everywhere, and anything that varies lives here, per machine, uncommitted.

**Start with `npm run doctor`.** It checks reality rather than trusting either file, and tells
you what to fix. Fill this in from what it reports.

---

## Checkout path

```text
<paste the absolute path>
```

Anything about it worth knowing — a space, an `&`, OneDrive sync, a network drive. A `&` in the
path breaks npm/npx `.bin` shims, which is why `scripts/build.cjs` calls entry scripts through
node directly.

## Node

`.nvmrc` pins the major version and CI builds on it. Record how you install/switch it here
(nvm-windows, fnm, volta, plain installer).

## PostgreSQL

How it runs on this machine, and the exact command to start it. The two setups seen so far:

**Windows service**

```powershell
Get-Service postgresql-x64-16
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h 127.0.0.1 -d telestar_crm
```

**Portable install** — start it detached; a foreground `pg_ctl start` holds the console pipe.

```powershell
Start-Process -FilePath 'C:\path\to\pgsql\bin\pg_ctl.exe' `
  -ArgumentList '-D','C:\path\to\data','-l','C:\path\to\pg.log','start' -WindowStyle Hidden
```

> Pass SQL to `psql` with `-f file.sql`, not `-c "..."` — PowerShell strips the double quotes
> around identifiers, so `"CampaignLeadRequirement"` arrives lowercased and the statement fails
> with `relation ... does not exist`.

## Env file

The repo works with either `.env` or `.env.local`; `npm run doctor` reports which it found.
`scripts/with-env.mjs` loads both for every `npm run db:*` script, so the Prisma CLI behaves the
same either way — it does **not** read `.env.local` on its own.

Record which one this machine uses and anything unusual in it.

## Shadow database

`SHADOW_DATABASE_URL` in your env file. It must exist before `npm run db:drift` works:

```sql
CREATE DATABASE telestar_shadow;
```

Throwaway — the drift gate recreates its contents on every run.

## Redis

Optional. Only `tests/redis-integration.test.ts` needs a real one; every other queue suite mocks
the library. Record how you run it, or note that you do not.

## Tooling

`gh` (GitHub CLI) is optional and only needed to open or inspect PRs from the terminal. Note how
it is installed here — a PATH change does not reach an already-running shell, so a fresh terminal
is needed after installing.

## Anything else that surprised you

The point of this file. If you lost time to it once, write it down so the next machine does not.
