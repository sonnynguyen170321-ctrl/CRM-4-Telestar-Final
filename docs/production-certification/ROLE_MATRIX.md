# Telestar CRM — 6-Role Operational & Permission Matrix

**Program**: Zero-Assumption Production Certification  
**Candidate SHA**: see `certification.config.json` — this document does not restate it.
> A second copy of the candidate SHA is a second thing to keep in step, and the previous one
> named `cf23182`, a candidate superseded twice over.  
**Requirement Ref**: `ROLE-001` through `ROLE-012`  
**Last Updated**: 2026-08-19T23:00:00+07:00  

---

## 1. Role Definitions & Hierarchy

```
                    ┌─────────────────────────┐
                    │        DIRECTOR         │ (Executive / Full Tenant Scope)
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
┌─────────────────────────┐                   ┌─────────────────────────┐
│      FLOOR MANAGER      │                   │     LEADGEN MANAGER     │
│  (SDR Ops & Management) │                   │  (Lead Pool & Sourcing) │
└───────────┬─────────────┘                   └───────────┬─────────────┘
            │                                             │
            ▼                                             ▼
┌─────────────────────────┐                   ┌─────────────────────────┐
│        TEAM LEAD        │                   │         LEADGEN         │
│   (Pod Lead & Coach)    │                   │   (Research & Sourcing) │
└───────────┬─────────────┘                   └─────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│           SDR           │
│ (Outreach & Prospecting)│
└─────────────────────────┘
```

---

## 2. Capability & Access Control Matrix

| Capability / Resource Area | Director | Floor Manager | Team Lead | SDR | Leadgen Manager | Leadgen | Verification Suite |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **View Tenant Wide Analytics** | Allowed | Allowed | Denied (Pod Only) | Denied (Self Only) | Denied | Denied | `tests/phase-9-role-surfaces.test.ts` |
| **Manage Users & Roles** | Allowed (All) | Scoped (SDR/TL) | Denied | Denied | Denied | Denied | `tests/floor-manager-administration.test.ts` |
| **Create/Edit Clients & Campaigns** | Allowed | Allowed | View Assigned | View Assigned | View Assigned | Denied | `tests/campaign-playbook.test.ts` |
| **Reassign Leads & Transfer Work** | Allowed | Allowed | Pod Members | Denied | Denied | Denied | `tests/transfer-work.test.ts` |
| **Access Unassigned Leads** | Allowed | Allowed | Denied | Denied | Denied | Denied | `tests/podScoping.test.ts` |
| **Run Sequences & Outbound Email** | Allowed | Allowed | Allowed | Allowed (Assigned) | Denied | Denied | `tests/role-journeys.test.ts` |
| **Log Meetings & Deals** | Allowed | Allowed | Allowed | Allowed (Assigned) | Denied | Denied | `tests/meetings.test.ts` |
| **Approve Client Reports** | Allowed | Allowed | Denied | Denied | Denied | Denied | `tests/client-report-scope.test.ts` |
| **Lead Pool Sourcing & Ingestion** | Allowed | View Only | View Only | View Only | Allowed (Full) | Sourcing / Enrichment | `tests/leadgen-pool.test.ts` |
| **Lead Pool Allocation to SDRs** | Allowed | Allowed | Denied | Denied | Allowed | Denied | `tests/leadgen-redesign.test.ts` |
| **Admin System Audit Logs** | Allowed | Allowed | Denied | Denied | Denied | Denied | `tests/admin-audit.test.ts` |
| **Email Health & Domain Controls** | Allowed | Allowed | View Only | View Only | Denied | Denied | `tests/email-health-access.test.ts` |

---

## 3. Human Workflow Journeys Tested

### 1. Director Journey (`ROLE-001`, `ROLE-002`)
- High-level tenant oversight across campaigns, opportunities, and pipeline metrics.
- Absolute administrative authority: user provisioning, role promotions, and transfer of orphaned assets.
- Approved client performance snapshots and shared external reporting links.

### 2. Floor Manager Journey (`ROLE-003`, `ROLE-004`)
- Daily operations engine: balancing SDR lead workloads, monitoring cadence metrics, and managing pod reassignments.
- Scoped user administration: promoting SDRs to Team Leads, adjusting send caps, and pausing troubled accounts.

### 3. Team Lead Journey (`ROLE-005`, `ROLE-006`)
- Coaching & quality: reviewing pod outreach, approving meetings, monitoring SDR progress, and assisting on difficult prospects.
- Enforces pod isolation: cannot view or tamper with other team leads' pods or deals.

### 4. SDR Journey (`ROLE-007`, `ROLE-008`)
- Focused execution: prospecting assigned leads, enrolling into cold sequences, scheduling meetings via booking links, and progressing deals.
- Zero horizontal visibility: cannot view unassigned accounts or leads assigned to other SDRs.

### 5. Leadgen Manager Journey (`ROLE-009`, `ROLE-010`)
- Lead sourcing management: configuring ICP matching requirements, deduplication threshold scoring, and approving CSV imports.
- Converting verified pool records into active CRM leads assigned to specific campaigns and SDRs.

### 6. Leadgen Researcher Journey (`ROLE-011`, `ROLE-012`)
- Research & enrichment: discovering contact emails, verifying LinkedIn URLs, enriching firmographic data, and submitting pool items.
- Scoped visibility: works primarily in `/leadgen` pool; CRM pipeline deals are restricted.

---

## 4. Verification Evidence
All 6 operational journeys and access control boundaries are validated in `tests/role-journeys.test.ts`, `tests/podScoping.test.ts`, `tests/phase-9-role-surfaces.test.ts`, and `tests/floor-manager-administration.test.ts`.
