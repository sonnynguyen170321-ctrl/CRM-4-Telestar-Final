# Hostinger VPS inventory — `srv1908578` (Kuala Lumpur, rebuilt 2026-09-13)

Captured over SSH. Nothing on the box was changed while capturing it.

> **The box was wiped on 2026-09-13.** Changing a Hostinger VPS's location is a full reinstall that
> [permanently deletes all data, backups and snapshots](https://support.hostinger.com/en/articles/10289743-how-to-transfer-your-vps-to-a-different-location-in-hostinger).
> The Nextcloud stack that ran here — app, Postgres 17, Redis, cron, and every file and account in
> it — is gone and unrecoverable; no backups were purchased. The VPS is now **dedicated to the CRM**
> unless the owner reinstalls Nextcloud from Hostinger's free template.

## Host

| | |
|---|---|
| Plan | Hostinger KVM 4 — 4 vCPU (AMD EPYC 9354P), **16 GB RAM**, 193 GB NVMe |
| Location | **Kuala Lumpur, MY** (AS47583 Hostinger). ~5–10 ms to Cloud SQL in `asia-southeast1`; 56 ms from Vietnam |
| Public IP | `187.127.110.204` (was `2.24.193.71` in Boston) |
| IPv6 | `2a02:4780:5e:e8c9::1` — note `curl ifconfig.me` from the box returns this, not the v4 address |
| Hostname | `srv1908578.hstgr.cloud` — Hostinger-managed DNS, follows the IP automatically |
| OS | Ubuntu 24.04.4 LTS, reinstalled 2026-09-13 06:48 UTC |
| Docker | Engine 29.7.2, Compose 5.4.0 |
| Disk | 1.4 GB of 193 GB used |
| SSH | `root`, key auth (`claude-telestar-crm` ed25519 — **re-added after the wipe**, the reinstall clears `authorized_keys`) |
| **Platform backup** | **none.** Not purchased, and a location change would delete it anyway. `deploy/hostinger/backup.sh --offsite` is the only backup that will exist. |

## What is running

| Container | Image | Note |
|---|---|---|
| `traefik-traefik-1` | `traefik:latest` | The only container. `network_mode: host`, owns 80/443 |

Volumes: `traefik_traefik-letsencrypt` and a stray `traefik-letsencrypt` (empty, from an earlier
compose project name). No application volumes. Compose project lives in `/docker/traefik`.

## Ports

| Port | Owner |
|---|---|
| 80, 443 | Traefik |
| 22 | sshd |

Nothing else listens. `ufw` is inactive and `iptables INPUT` is ACCEPT after the reinstall — see
`FIREWALL.md`; both layers go up before any production data lands.

## Traefik — the integration contract

`traefik:latest`, `network_mode: host`, Docker provider with `exposedbydefault=false`, so a container
is routed **only** if it carries `traefik.enable=true` labels. Entrypoints `web` :80 → permanent
redirect to `websecure` :443. Let's Encrypt resolver `letsencrypt`, **HTTP-01** on `web`, storage
`/letsencrypt/acme.json` in volume `traefik_traefik-letsencrypt`. No file provider, no dynamic
directory — routing is 100 % labels. ACME email is `admin@srv1908578.hstgr.cloud`.

Because Traefik is on the host network it reaches containers on any bridge network by IP, so the CRM
keeps its own `crm_internal` network and **does not** join a shared one. This is what
`docker-compose.hostinger.yml` implements:

```yaml
web:
  labels:
    - traefik.enable=true
    - traefik.http.routers.crm.rule=Host(`crm.telestar.cloud`)
    - traefik.http.routers.crm.entrypoints=websecure
    - traefik.http.routers.crm.tls.certresolver=letsencrypt
    - traefik.http.services.crm.loadbalancer.server.port=3000
```

The CRM runs no Caddy (`caddy` → `profiles: [disabled]`) and publishes no port.

## Resource budget

The CRM alone: web 3 GB + worker 3 GB + Redis 1 GB + `crm-db` 4 GB = **11 GB of ceilings** against
16 GB, with nothing else on the box. Comfortable, and the reason host prep sets a **4 GB** swapfile
rather than 2 GB. If Nextcloud is reinstalled later it adds ≈ 450 MB resident — still fine, but it
must bring its own Postgres and Redis and publish no host ports.

## Preparation required after every reinstall

Everything a previous session installed was erased. `RUNBOOK.md` → *One-time host preparation*:
4 GB swap + `vm.swappiness=10`, docker log rotation, `/opt/crm/{backups,secrets}` and
`/opt/crm-staging`, `rclone jq postgresql-client-16 nmap`, `ufw` (SSH rule first), `docker login ghcr.io`.

## Decisions this inventory settles

1. Reverse proxy is Traefik, by labels. No shared network, no second proxy, no published ports.
2. The CRM brings its own Postgres and Redis; nothing is shared with any other app.
3. Latency no longer forces a combined cutover — KL→Singapore is single-digit milliseconds, so
   compute can move first and the database later.
4. With no platform backup, an off-host dump target and a rehearsed restore are a **hard gate**
   before production data lands. `prod-check-env` now requires `BACKUP_REMOTE` on this target.
5. The compose project is `crm` at `/opt/crm`; staging is `crm-staging` at `/opt/crm-staging`.
