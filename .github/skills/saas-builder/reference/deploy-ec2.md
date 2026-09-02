# Deploy — single-host docker-compose playbook

Ship the whole stack on **one host** with docker-compose behind Caddy auto-HTTPS, backed by managed
Postgres + Redis. Reference implementation: **TeleStar V2** — `deploy/aws-ec2/**` (on branch
`feat/aws-ec2-deploy`), `Dockerfile`, `prisma.config.ts`, `.github/deploy-ec2.yml`, `terraform/`,
`docs/…/CONSOLE-SETUP.md`. This is the proven bring-up; the automated CI/Terraform path is a
superset of it.

## Topology

```
caddy(:80/:443)  ──reverse_proxy──>  web:3000
                                     worker   (job runtime, BullMQ)
                                     imap/poller (optional inbound)
                                     migrate  (one-shot: prisma migrate deploy, then exit)
```

**One prebuilt image**, shared by web/worker/imap/migrate — only the `command` differs. Managed
**RDS Postgres** + **ElastiCache Redis** in the **same VPC** (SG-to-SG rules).

## Two env files, different jobs

- **`.env`** — compose interpolation only: `APP_IMAGE`, `APP_DOMAIN` (feeds `${…}` in
  `docker-compose.yml`).
- **`.env.production`** — the app runtime env, loaded via compose `env_file`: `DATABASE_URL`,
  `REDIS_URL`, secrets, `NEXT_PUBLIC_APP_URL`, `V2_BULL_ENABLED`, `V2_WORKER_*`, `V2_AUTH_SECRET`.

## The gotcha ledger — every one of these was paid for in blood

1. **Runner image must COPY `scripts/` + `lib/`.** worker/imap run outside Next and transpile
   `lib/` on the fly; a Next-only image dies `Cannot find module scripts/…worker.mjs`.
2. **`prisma.config.ts` must read `process.env.DATABASE_URL`** directly, not prisma's `env()` helper
   — else `migrate deploy` fails `datasource.url required` in a container.
3. **RDS SSL has two answers**: the `pg` runtime adapter needs `sslmode=no-verify`; the prisma
   migrate engine needs `sslmode=require`. Same DB, different libs. Symptom if wrong:
   `self-signed certificate in certificate chain`.
4. **ElastiCache Serverless = cluster mode** → connection is `rediss://` (TLS mandatory) **and** the
   BullMQ prefix must be hash-tagged `{…}` or jobs fail `CROSSSLOT`.
5. **Security Group must open 80 + 443** to the internet. 80 is not optional — Caddy needs it for
   the Let's Encrypt HTTP-01 challenge, so missing 80 = no cert = no HTTPS.
6. **`NEXT_PUBLIC_*` is baked at build time** — pass the final `https://<domain>` as a
   `--build-arg`, not just a runtime env, or the browser bundle points at the wrong origin.
7. **Small hosts OOM during `next build`** (t3.medium 4GB) — add swap + `NODE_OPTIONS=
   --max-old-space-size` and skip the in-build tsc (typecheck gated separately).
8. **Migrate before serve** — the one-shot `migrate` service runs `prisma migrate deploy` and must
   pass before web/worker start.
9. **App is served at the domain, not the raw IP** — Caddy binds `{$APP_DOMAIN}` (e.g. an
   `sslip.io` name), so `http://<ip>` won't serve; use `https://<domain>`.
10. **Something else may hold :80** on the host (a stray nginx). Free it before starting caddy.

## Health gate

`app/api/health/route.ts` → `{status:"ok",database:"ok"}` on `SELECT 1`, else 503. It's the compose
healthcheck, the Caddy `depends_on` gate, and your smoke test:
```
curl -s https://<domain>/api/health         # expect "database":"ok"
docker compose logs worker | grep "workers listening"
```

## Provisioning the first admin

Run the idempotent signup script inside the app image (shares `DATABASE_URL` + `V2_AUTH_SECRET`):
```
docker compose run --rm --no-deps worker \
  node scripts/v2-signup.mjs --email you@x.com --name you --role OWNER --password '<10+ chars>'
```

## Session fit

`deploy` change-kind, near the end of the queue. Consumes: a built, migratable, tested app.
Produces: the running stack + health-gate pass. Exit-gate: `curl /api/health` = `database:ok` and
worker `workers listening`.
