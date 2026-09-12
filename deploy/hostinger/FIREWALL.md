# Firewall for `srv1908578` — two layers, same rules

Inventory (2026-09-12): `ufw` inactive, `iptables INPUT` policy ACCEPT, Nextcloud's `41115/tcp`
published on `0.0.0.0` by Hostinger's template. The only protection today is whatever Hostinger's
managed firewall applies. Both layers below must be in place **before Phase 6a**.

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

**Docker bypasses `ufw` for published ports** (it inserts its own `DOCKER` iptables chain). That is
why the CRM overlay publishes **no** ports at all — nothing to bypass. Nextcloud's `41115` is a
published port and therefore stays reachable regardless of `ufw`; to close it, either remove
`ports:` from `/docker/nextcloud-o38n/docker-compose.yml` (Traefik routes by container IP, the
port is unused) or add to `/etc/ufw/after.rules` in the `DOCKER-USER` chain:

```
-A DOCKER-USER -p tcp --dport 41115 ! -s 127.0.0.1 -j DROP
```

That change is Nextcloud's, not the CRM's — make it with the owner watching.

## Verify (run after each change)

```bash
ss -tlnp | awk 'NR>1{print $4}' | sort -u      # expect only :22, :80, :443 (+ 41115 until closed)
nmap -Pn -p 22,80,443,3000,5432,6379,41115 <vps-ip>   # from outside: 3000/5432/6379 must be filtered
```
