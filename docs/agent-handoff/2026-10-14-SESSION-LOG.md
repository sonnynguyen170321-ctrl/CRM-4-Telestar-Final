---
classification: CURRENT_REFERENCE
note: Session log for 2026-10-11..14. State below is as of writing — verify against GitHub and production before acting on it.
---

# Session log — 2026-10-11..14: dialer live, owner feedback batch (A–I), composer send controls + AI

```bash
git fetch origin && git log --oneline -12 origin/main
curl -s https://crm.telestar.cloud/api/health      # .commit = what production runs
```

Production at writing runs `06dbad5f` (#289). Main is `8591b124` (#298). Everything below is merged
and **not yet deployed**. One deploy covers all of it.

## The owner's requests

- Dialer: live call debugging; Vietnamese numbers through the CRM (keep the phone QR); one call screen;
  then "floating dialer, rep picks any company number to call out from".
- Every campaign scores against its own ICP (no silent fallback). SDRs may edit and publish their own
  ICP, with team lead / manager review.
- Feedback batch 2026-10-13 (8 items): raw HTML in email bodies, meaningless people research, Lead
  Filter page is useless, ICP "edit score" 404 + list inputs that cannot be typed freely, floating
  dialer with caller-ID choice, company website missing in the lead drawer, more template variables
  ("more creative — AI tailored, a place for reps to try ways to crack the outreach"), sequence email
  tasks not auto-logged (decision: email steps with a template send themselves).
- "Do the leftover pending work": composer send controls (old PR 3) and composer AI + content score
  (old PR 4). Then: "push everything, I deploy once".

## What merged

| PR | What | Deploy note |
|----|------|-------------|
| #281–#282 | Campaign-owned ICP; SDR personal ICPs publish through team lead / manager review | deployed earlier |
| #283–#287 | Dialer fixes: transfer-leg matching, answeredAt only from `call.answered`, recordings, VN through the dialer, one call screen with phone QR | deployed earlier |
| #288–#289 | Shared composer (TipTap), CC/BCC, attachments, snippets, threaded inbox replies, Outlook Message-ID | deployed (`06dbad5f`) |
| #290 (I) | Nine new industry keys, Internet → SOFTWARE, verdict v4 / classifier v2 | **rescore after deploy** |
| #291 (A) | Email bodies rendered as sanitized HTML, Lead Filter removed, company website in the drawer, dead `/leads/[id]` links → slide-over | — |
| #292 (B) | ICP editor: honest 403/409 instead of 404, chip inputs for every list field | — |
| #293 (F) | Personalization lab: data / sender / time-aware / `{{ai.*}}` variables, spintax, conditionals, fallbacks, variant stats | migration: `User.phone/jobTitle/calendarLink`, `LeadAiInsight.variablesJson` |
| #294 (C) | Sequence email steps with a template send and log themselves; Complete on an auto step refused unless "sent outside the CRM"; stuck states settled | **run `sequence:autosend` dry run, then `--apply`** |
| #295 (D) | People research: contact location parsed, geo gate, person verification, matched-evidence chips, Afghanistan + missing countries | migration: `ResearchCandidate.country` |
| #296 (E) | Docked dialer: survives navigation, search any lead by name/company/phone or keypad, "From" picks any active company number (server-validated, bound in the call token, `Call.fromE164`, shown in the call activity) | — |
| #297 (G) | Composer send controls: schedule send, undo 10 s, draft autosave (`EmailDraft`), test send to myself, per-email tracking toggle + tenant defaults, live status, pre-send checklist | migration + **new tenant table → reapply `supabase/rls.sql`** |
| #298 (H) | AI rewrite on the draft (shorten, friendlier, formal, grammar, EN↔VI, instruction) with template-token protection; deterministic content score | — |

Reviews: C, D, E, G and H each had a security review, H a second independent one. No CRITICAL was
found. G: one MEDIUM (a replayed POST could resurrect an undone email) and seven LOWs, all fixed. H: two
HIGH (model-added tracking image / merge token in a link; regex link check bypassable), both fixed and
confirmed closed by the re-review, plus a quadratic `htmlToPlainText` / `unchipifyMergeTags` that could
stall the send, preview and test-send routes (fixed: linear, plus a 5000-element / depth-100 cap →
413 `body_too_complex`).

## Deploy and run order (owner)

GHCR login on the VPS was renewed 2026-10-14 (account BrandNg, classic PAT `read:packages`). The old
token expired 2026-10-13 and made the previous deploy fail with `error from registry: denied`.

```bash
ssh telestar-vps
cd /opt/crm && git fetch origin && git checkout 8591b1241c49b95fa376e98ab71fa4e697691d82
./scripts/deploy.sh 8591b1241c49b95fa376e98ab71fa4e697691d82
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC exec -T crm-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < supabase/rls.sql   # EmailDraft (#297)
curl -s https://crm.telestar.cloud/api/health    # .commit should be 8591b124
```

Then, in order:

1. Rescore (verdict v4, #290): `$DC exec -T web npx tsx scripts/backfill-lead-icp.ts --all` (preview),
   then `--all --apply`.
2. Sequence email auto-send (#294): `$DC exec -T web npx tsx scripts/sequence-email-autosend.ts --tenant default-tenant`
   (dry run, review the list), then `--apply --tenant default-tenant` (spreads due times over the next
   send window; `--spread-minutes 240` to widen).
3. People research check (#295): `$DC exec -T web npx tsx scripts/research-people-eval.ts --tenant default-tenant`
   (read-only, before/after country match), then "Check again" on recent contact runs in /research.
4. Settings → profile: each sender's phone, title, calendar link (feeds `{{senderPhone}}` etc.).
5. Smoke in the browser: open the dialer from the top bar (Alt+Shift+D), pick a "From" number, call a
   lead; compose an email → schedule, Undo, reopen (draft restored), "Send test to me", AI → Shorten.
6. Outlook: send one test with BCC to confirm BCC delivery.

## Still open

- Dialer: `+84909…` did not ring from the US caller ID (carrier filtering suspected) — get a VN caller
  ID / port the Bigin numbers. Telnyx balance was low ($6.82) — recharge. Confirm concurrency ≥ 40.
- Inbox reply route: a 100k-char body full of tags the sanitizer must strip costs ~1.8 s of server CPU
  (bounded by the element cap). Lower the cap for that route if it shows up.
- Composer UI has no component/browser test; the AI rewrite has had no live provider smoke test.
- Five Dependabot PRs (#133 prisma, #159, #243 openai, #244 lucide-react, #245 googleapis) left alone;
  prisma and googleapis are big jumps and want their own session.
- Owner items carried over: `ALERT_WEBHOOK_URL`; reset the shared default login password; rotate the
  admin password that was pasted in chat; PBX password rotation and remove `SIP_*` after cut-over;
  uptime monitor; `DATABASE_URL` `connection_limit`; run `preflight-health.sql`.
