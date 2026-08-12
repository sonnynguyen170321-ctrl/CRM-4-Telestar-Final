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

1. **The board.** Eight states. AI managed, needs attention, waiting, re-engagement eligible,
   approvals, blocked. Totals across the top.
2. **The prospect.** Click Dana. Why AI contacted her — the Rotterdam hub signal, the
   operational-cost pain hypothesis, the role hook. This is the grounding for the outreach.
3. **The reply.** *Interested reply* under the demo controls. It goes through the same
   `handleApplyReply` chokepoint as real mail: classified, cadence paused, ownership moved.
   Operating state flips `ai_managed → human_attention`, a high-priority task appears.
4. **AI assists.** *Draft reply* / *Summarise thread*. Nothing sends — the SDR copies and edits.
5. **The other classes.** *Out of office* pauses with a dated reminder and **no** SDR interrupt;
   *Unsubscribe* stops, suppresses and unenrolls with no task and no notification.
6. **The loop.** Marcus is waiting and eligible. *Resume AI follow-up* opens a re-engagement
   work order — and starts no outreach.
7. **The manager view.** Sign in as the Director: totals, timeline, and an outcome with its
   evidence and a **proposed** playbook change requiring manager approval.

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
