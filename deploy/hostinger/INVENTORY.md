# Hostinger VPS inventory — `srv1908578` (read-only, 2026-09-12)

Captured over SSH before any CRM bytes land on the box. Nothing here was changed.

## Host

| | |
|---|---|
| Plan | Hostinger KVM 4 — 4 vCPU (AMD EPYC 9354P), **16 GB RAM**, 193 GB NVMe |
| Location | **Boston 2** (to be relocated to Singapore — Phase 0; Cloud SQL is `asia-southeast1`) |
| Public IP | `2.24.193.71` (changes on relocation) |
| OS | Ubuntu 24.04.4 LTS, up 3 weeks |
| Docker | Engine 29.7.2, Compose 5.4.0 |
| Memory in use | 858 MB used, **10.8 GB free**, 4.7 GB buff/cache |
| Swap | **none** (0 MB) |
| Disk `/` | 4.8 GB of 193 GB (3 %) |
| SSH | `root`, key auth (`claude-telestar-crm` ed25519 added 2026-09-12) |
| Hostinger backup | weekly VPS snapshot (not DB-consistent) |

## Who owns the ports

| Port | Owner | Note |
|---|---|---|
| 80, 443 | **Traefik** (`traefik-traefik-1`, `network_mode: host`) | The only reverse proxy. CRM must route through it. |
| 22 | sshd | |
| 41115 | docker-proxy → Nextcloud :80 | Published on `0.0.0.0` by Hostinger's template; not needed with Traefik in front. Out of scope for the CRM; worth closing at the firewall. |

No other listeners. `ufw` is **inactive** and `iptables INPUT` policy is **ACCEPT** — the only firewall is whatever Hostinger's managed firewall applies (check hPanel → Firewall before Phase 3).

## Traefik (`/docker/traefik`)

- `traefik:latest`, `network_mode: host`, Docker provider with `exposedbydefault=false` → a container is routed **only if it carries `traefik.enable=true` labels**.
- Entrypoints `web` :80 → permanent redirect to `websecure` :443.
- Let's Encrypt resolver `letsencrypt`, **HTTP-01** challenge on `web`, storage `/letsencrypt/acme.json` (volume `traefik-letsencrypt`), ACME email `admin@srv1908578.hstgr.cloud`.
- No file provider, no dynamic config directory. Routing is 100 % labels.
- Because Traefik is on the host network it reaches containers on any bridge network by IP — Nextcloud lives on `nextcloud-o38n_default` and is routed fine. The CRM's own compose network will work the same way; **no shared network is required**.

This is the integration contract for `docker-compose.hostinger.yml`:

```yaml
web:
  labels:
    - traefik.enable=true
    - traefik.http.routers.crm.rule=Host(`crm.telestar.cloud`)
    - traefik.http.routers.crm.entrypoints=websecure
    - traefik.http.routers.crm.tls.certresolver=letsencrypt
    - traefik.http.services.crm.loadbalancer.server.port=3000
```

The CRM must **not** run its own Caddy (`caddy` service → `profiles: [disabled]`) and must not publish any port.

## Nextcloud (`/docker/nextcloud-o38n`, Hostinger app template)

| Service | Image | Notes |
|---|---|---|
| nextcloud | `nextcloud:30-apache` | 274 MB RSS; host `nextcloud-o38n.srv1908578.hstgr.cloud` (Hostinger subdomain — DNS is managed by Hostinger, so relocation needs **no** manual Nextcloud DNS change) |
| db | `postgres:17-alpine` | 42 MB; Nextcloud only. The CRM will run its **own** Postgres 16 (`crm-db`); do not share. |
| redis | `redis:7-alpine` with `--requirepass` | `maxmemory` unset (default) → policy default `noeviction`, but it is Nextcloud's cache and password-protected; the CRM runs its **own** Redis (`noeviction`, AOF on). |
| cron | `nextcloud:30-apache` | 2 MB |

Total Nextcloud + Traefik footprint today: **≈ 435 MB RAM**, negligible CPU at rest (Nextcloud showed 24 % CPU during the sample — its cron/preview jobs).

## Resource gate B1

Required headroom for the CRM: web ≈ 1–1.5 GB, worker ≈ 0.5–1 GB, Redis ≤ 1 GB (limit), Postgres ≤ 4 GB (limit, Phase 6b) → **≤ 7.5 GB** at the limits. Available: 15.1 GB. **Gate passes** with > 50 % headroom even at every limit. Disk: 193 GB free for images, logs, dumps and two backup generations.

Caveats to fix before Phase 6a:
- **No swap.** Add a 2 GB swapfile with `vm.swappiness=10` so a burst evicts cache instead of OOM-killing Postgres.
- **No host firewall.** Enable `ufw` (22 from allow-listed IPs, 80, 443) *after* adding the SSH rule; then mirror in Hostinger's managed firewall.

## Decisions this inventory settles

1. Reverse proxy = Traefik via labels. No network join, no second proxy.
2. Nextcloud's DB and Redis stay private; the CRM brings its own of both.
3. Relocation to Singapore does not require Nextcloud DNS edits (hstgr.cloud subdomain).
4. The CRM compose project is `crm` at `/opt/crm` (staging: `crm-staging` at `/opt/crm-staging`), separate from `/docker/*` which Hostinger's app manager owns.
