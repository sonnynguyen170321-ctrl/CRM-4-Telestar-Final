# Firewall for `srv1908578` — two layers, same rules

After the Kuala Lumpur reinstall the box is bare: `ufw` inactive, `iptables INPUT` policy ACCEPT,
nothing listening but sshd and Traefik. It is now CRM-dedicated and has **no platform backup**, so
both layers below are in place before any production data lands — not before Phase 6a.

## Layer 1 — Hostinger managed firewall (hPanel → VPS → Firewall)

Rule groups **drop everything not allowed once activated**. Add the SSH rule first or you lock
yourself out.

| Action | Protocol | Port | Source |
|---|---|---|---|
| Accept | TCP | 22 | your office / VPN IPs only (add each; never `any`) |
| Accept | TCP | 80 | any (Let's Encrypt HTTP-01 + redirect) |
| Accept | TCP | 443 | any |

Do **not** add 3000, 5432, 6379, 41115. Activate the group, then confirm a **new** SSH session
still works before closing the old one.

## Layer 2 — `ufw` on the host (belt and braces; survives relocation)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow from <office-ip>/32 to any port 22 proto tcp comment 'ssh office'
ufw allow from <vpn-ip>/32   to any port 22 proto tcp comment 'ssh vpn'
ufw allow 80/tcp  comment 'traefik http'
ufw allow 443/tcp comment 'traefik https'
ufw --force enable
ufw status numbered
```

Traefik runs with `network_mode: host`, so 80/443 are host ports and `ufw` governs them directly.

**Docker bypasses `ufw` for published ports** — it inserts its own `DOCKER` iptables chain ahead of
`ufw`'s rules. That is why the CRM overlay publishes **no** ports at all: there is nothing to bypass.
If an application is ever added that does publish a port, either remove its `ports:` (Traefik routes
by container IP and does not need one) or drop it in the `DOCKER-USER` chain via
`/etc/ufw/after.rules`.

## Verify (run after each change)

```bash
ss -tlnp | awk 'NR>1{print $4}' | sort -u        # expect only :22, :80, :443
nmap -Pn -p 22,80,443,3000,5432,6379 187.127.110.204   # 3000/5432/6379 must be filtered
```
