# Demo runbook — Telestar AI

## Setup

```bash
npm run demo:reset                       # isolated demo tenant, safe to re-run live
node ./node_modules/next/dist/bin/next dev
```

Open **`/ai`** — "AI Console" in the sidebar.

| | |
|---|---|
| SDR | `demo.sdr@telestar.demo` / `TelestarDemo!2026` |
| Director | `demo.director@telestar.demo` / `TelestarDemo!2026` |
| Prospect | Dana Whitfield, VP Operations, Acme Logistics (`demo-lead-dana`) |
| Ghosted prospect | Marcus Vale, Halden Freight (`demo-lead-marcus`) |

`DEMO_PASSWORD` overrides the password. `npm run demo:reset` touches **only** the
`demo-telestar` tenant — every delete is filtered on `tenantId`, there is no `migrate reset`
and no `TRUNCATE`.

## The story

1. **The board.** Sign in as the SDR. The top of `/ai` is **their** surface: what AI is handling
   as one number, then only the things needing a person. Below it, the operating loop and the
   prospect queue across eight states.
2. **The prospect.** Click Dana. Why AI contacted her — the Rotterdam hub signal, the
   operational-cost pain hypothesis, the role hook. This is the grounding for the outreach.
3. **The reply.** *Interested reply* under the demo controls. It goes through the same
   `handleApplyReply` chokepoint as real mail: classified, cadence paused, ownership moved.
   Operating state flips `ai_managed → human_attention`, a high-priority task appears.
4. **AI assists.** *Draft reply* / *Summarise thread*. Nothing sends — the SDR edits in place and
   sends it themselves. *I used this* records how much of the draft survived; that is a Phase 10
   signal, and it sends nothing either.
5. **The other classes.** *Out of office* pauses with a dated reminder and **no** SDR interrupt;
   *Unsubscribe* stops, suppresses and unenrolls with no task and no notification.
6. **The loop.** Marcus is waiting and eligible. *Resume AI follow-up* opens a re-engagement
   work order — and starts no outreach.
7. **The manager view.** Sign in as the Director. Same URL, **different surface**: prospects
   worked, replies, meetings, opportunities, AI spend and cost per meeting — no task queues, no
   deferral reasons. That is the Phase 9 claim, visible in one click.
8. **Approved learning.** *Review outcomes* on the playbook proposals panel. It scans the CRM's
   own rows — four prospects who were handed back and then replied — records them as durable
   evidence and files one proposal: *follow up after 6 business days instead of 10*.
   Each row shows the evidence, the change, and what approving and rejecting each do.
   **Approve** creates **draft version 2**. The version in force is still version 1, still says
   ten days, and nothing sends differently. Show that: it is the whole point.

An SDR signed in at the same screen has no *Review outcomes* button and no decision buttons — and
the API refuses them directly, because the UI is not the gate.

## Email safety

The demo mailbox has no provider credentials, and `EMAIL_SEND_DRY_RUN` is on unless explicitly
set to `"false"`. The real pipeline stays visible — `OutboundMessage`, queue, worker — and
nothing leaves the building. **Do not set `EMAIL_SEND_DRY_RUN=false`.**

## If something looks wrong

```
GET /api/demo/diagnostics?leadId=demo-lead-dana
```

Operating state, enrollments, tasks, work orders, agent actions, approvals, reply
classification, job runs, activities, transitions and re-engagement eligibility in one JSON
response.

## Walkthrough test

```bash
npm run demo:reset
BASE_URL=http://localhost:3000 npx playwright test --project=demo
```

Screenshots land in `playwright/demo-shots/`.

## Known behaviour worth expecting

- **With no AI provider configured**, classification uses the deterministic rules plus a narrow
  high-precision phrase fallback. The four demo replies all classify correctly; an unusual reply
  lands in class D (human review), which is the designed behaviour, not a fault.
- **AI assistance** reports "AI is unavailable" without a provider, and still shows the CRM's own
  recommended objective. That is worth showing rather than hiding.
