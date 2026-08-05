# Post-Migration UX Feedback

Not every finding is a bug. Items here are product improvements — things that work as built
but felt confusing, slow, or incomplete. Kept separate from `BUGS.md` so the stabilization
pass does not silently turn into a redesign.

Per `telestar-crm-post-migration-bug-fix-instructions.md` §12.

---

| ID | Role | Page | Feedback | Priority | Action |
|---|---|---|---|---|---|
| UX-001 | All | Login / whole app | Deployment is plain HTTP on a bare IP, so credentials cross the network in cleartext and the browser shows "Not secure" | High | Point a domain at `34.142.236.46`, then set `CADDY_SITE_ADDRESS` to the hostname and `NEXTAUTH_URL` to `https://…`. Caddy provisions the certificate itself |
| UX-002 | All | Whole app | Sign-in round-trip measured up to 37s against Cloud SQL `db-g1-small`. Usable for a demo, sluggish for daily work | Medium | Measure before acting. If it is the database, the tier is one flag; if it is cold Next.js routes, `--min-instances`-style warmth does not apply on a VM and the fix is elsewhere |
| UX-003 | Director / Floor Manager | `/admin` | ~~`/admin` returns 404 — there is no `app/admin/page.tsx`, only a layout. Navigation always deep-links to `/admin/jobs`, so it is only reachable by typing the URL~~ | Low | **Resolved 2026-08-05.** The Admin Control Center adds `app/admin/page.tsx` — an overview console, not a redirect — and `components/Sidebar.tsx` now links to `/admin` directly for director / floor_manager |

---

## Capture template

```text
Feedback ID:
Role:
Page:
What felt confusing:
What the user expected:
Recommended improvement:
Priority: High / Medium / Low
```
