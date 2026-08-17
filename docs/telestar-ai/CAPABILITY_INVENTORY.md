# 📋 TELESTAR AI — CURRENT CAPABILITY INVENTORY

> **Audit Date:** 2026-08-18 (Phase 0 Audit)  
> **Source of Truth:** Workspace codebase (`app/api/ai/`, `lib/ai/`, `lib/agent/`, `components/`)  

---

## 1. Executive Summary & Discovered AI Surface

The audit discovered **10 API routes**, **5 core runtime modules**, **12 tool definitions**, **4 provider integrations**, and **3 UI surfaces**.

---

## 2. Detailed Capability Inventory

### Capability 1: Conversational AI Command Center & Streaming Assistant
- **NAME:** Interactive AI Streaming Assistant (`AiAssistant`)
- **ROLE(S):** Director, Floor Manager, Team Lead, SDR, Leadgen Manager
- **PURPOSE:** Multi-turn conversational assistant with live tools, role persona adaptation, and page-aware action execution.
- **ENTRYPOINT:** `app/api/ai/chat/route.ts` / `components/AiAssistant.tsx`
- **MODEL:** `deepseek-r1-distill-llama-70b` / `llama-3.3-70b-versatile` / `claude-3-5-sonnet`
- **PROVIDER:** Groq / Anthropic / OpenRouter (via `lib/ai/provider.ts` & `lib/ai/providerRouting.ts`)
- **PROMPT:** Dynamic system prompt in `app/api/ai/chat/route.ts` embedding role mission, tenant context, and available actions.
- **CONTEXT:** User role, tenant ID, active CRM entity context, conversation history.
- **STRUCTURED OUTPUT:** Server-Sent Events (SSE) streaming tokens, structured tool calls (`json`).
- **TOOLS:** `searchLeads`, `updateLeadStage`, `assignLead`, `getCampaignMetrics`, `getSequencePerformance`, `getQueueStatus`, `reconcileQueue`, `getSystemHealth`.
- **READ/WRITE:** Read + Reversible Write
- **AUTHORIZATION:** RBAC verified via `requireAuth()` and `lib/agent/authorization.ts`.
- **USER-FACING:** Yes (Floating assistant & full AI Command Center page).
- **PROSPECT-FACING:** No.
- **BACKGROUND:** No (synchronous streaming).
- **TESTS:** `tests/ai-assistant-stream.test.ts`, `tests/agent-capability-autonomy.test.ts`.
- **KNOWN RISK:** Generic fallback prompts if situation context is incomplete.
- **DECISION:** **MODIFY & CONSOLIDATE** into unified Telestar AI Cognitive Stack.

---

### Capability 2: AI Email Reply Drafter
- **NAME:** Contextual AI Email Reply Generator
- **ROLE(S):** SDR, Team Lead
- **PURPOSE:** Draft personalized, context-aware reply to inbound prospect emails respecting sequence cadence and objections.
- **ENTRYPOINT:** `app/api/ai/draft-reply/route.ts`
- **MODEL:** `llama-3.3-70b-versatile` / `gpt-4o-mini`
- **PROVIDER:** Groq / OpenAI
- **PROMPT:** Grounded in prospect history, objection guidelines, and company value propositions.
- **CONTEXT:** Inbound email text, thread history, lead profile, campaign value props.
- **STRUCTURED OUTPUT:** `{ draftSubject: string, draftBody: string, reasoning: string, suggestedAction: string }`
- **TOOLS:** None (prompt grounded).
- **READ/WRITE:** Read only (generates draft for human review).
- **AUTHORIZATION:** `requireAuth()` with tenant isolation.
- **USER-FACING:** Yes (Email Inbox & Lead Detail slide-over).
- **PROSPECT-FACING:** No (Draft only until SDR clicks send).
- **BACKGROUND:** No.
- **TESTS:** `tests/draft-reply.test.ts`.
- **KNOWN RISK:** Potential hallucination of pricing if ungrounded.
- **DECISION:** **KEEP & ENHANCE** with Telestar AI Constitution & Evidence Grounding.

---

### Capability 3: Daily Role Briefing Generator
- **NAME:** Role-Aware Daily Briefing
- **ROLE(S):** Director, Floor Manager, Team Lead, SDR, Leadgen Manager
- **PURPOSE:** Synthesizes top priorities, overdue follow-ups, deliverability health, and team exceptions for the morning rhythm.
- **ENTRYPOINT:** `app/api/ai/daily-briefing/route.ts` & `app/api/ai/briefing/route.ts`
- **MODEL:** `llama-3.3-70b-versatile` / `deepseek-r1-distill-llama-70b`
- **PROVIDER:** Groq
- **PROMPT:** Role-specific briefing prompt synthesizing DB metrics into bulleted executive actions.
- **CONTEXT:** Overdue count, positive replies pending, bounce rates, unassigned leads, active campaigns.
- **STRUCTURED OUTPUT:** `{ summary: string, priorities: Array<{ id: string, title: string, urgency: string, actionUrl: string }> }`
- **TOOLS:** Deterministic DB queries.
- **READ/WRITE:** Read only.
- **AUTHORIZATION:** `requireAuth()`.
- **USER-FACING:** Yes (Dashboard hero card).
- **PROSPECT-FACING:** No.
- **BACKGROUND:** Cached daily per user in Redis.
- **TESTS:** `tests/briefing.test.ts`.
- **KNOWN RISK:** Duplication between `/api/ai/briefing` and `/api/ai/daily-briefing`.
- **DECISION:** **CONSOLIDATE** into single "What Needs Attention?" Engine (`P1.1`).

---

### Capability 4: Lead Research & Firmographic Enrichment
- **NAME:** Autonomous Lead Research & Evidence Extraction
- **ROLE(S):** Leadgen Manager, SDR
- **PURPOSE:** Extract firmographics, tech stack, employee count, and recent news from company domains.
- **ENTRYPOINT:** `app/api/ai/enrich-lead/route.ts` & `lib/research/`
- **MODEL:** `llama-3.3-70b-versatile`
- **PROVIDER:** Groq / Serper / Clearbit
- **PROMPT:** Fact-extraction JSON prompt enforcing strict citation and evidence grounding.
- **CONTEXT:** Company domain, prospect LinkedIn, company name.
- **STRUCTURED OUTPUT:** Structured JSON schema matching `ContactResearchCache`.
- **TOOLS:** Domain web crawler & search provider.
- **READ/WRITE:** Write (writes to `ContactResearchCache` and `AccountResearchCache`).
- **AUTHORIZATION:** Tenant-isolated work order engine (`lib/workorders/`).
- **USER-FACING:** Yes (Lead detail research card).
- **PROSPECT-FACING:** No.
- **BACKGROUND:** Async BullMQ worker (`workers/research-worker.ts`).
- **TESTS:** `tests/phase-7-knowledge.test.ts`, `tests/work-order-dispatch.test.ts`.
- **KNOWN RISK:** Cache staleness if external firmographic data changes.
- **DECISION:** **KEEP & ALIGN** with Section 27 Leadgen Quality Engine.

---

### Capability 5: Autonomous Meeting Outcome Drafter
- **NAME:** Meeting Summary & Stage Transition Assistant
- **ROLE(S):** SDR, Team Lead, Floor Manager
- **PURPOSE:** Transcribe/summarize meeting notes and suggest next pipeline stage (e.g. `discovery` ➔ `proposal_sent`).
- **ENTRYPOINT:** `app/api/ai/draft-outcome/route.ts`
- **MODEL:** `llama-3.3-70b-versatile`
- **PROVIDER:** Groq
- **PROMPT:** Meeting analysis prompt extracting action items, objections, and qualification score.
- **CONTEXT:** Raw user meeting notes, lead profile, deal value.
- **STRUCTURED OUTPUT:** `{ summary: string, nextStage: string, followUpTaskDue: string, actionItems: string[] }`
- **TOOLS:** None.
- **READ/WRITE:** Read only (suggests action).
- **AUTHORIZATION:** `requireAuth()`.
- **USER-FACING:** Yes (Meetings board modal).
- **PROSPECT-FACING:** No.
- **BACKGROUND:** No.
- **TESTS:** `tests/meetings.test.ts`.
- **KNOWN RISK:** Premature stage progression suggestion on weak notes.
- **DECISION:** **MODIFY** to enforce Evidence-Aware response standards (Section 47).

---

## 3. Consolidation & Action Plan Summary

| Route / Module | Current Action | Target Architecture State |
| :--- | :---: | :--- |
| `app/api/ai/chat/route.ts` | **MODIFY** | Wire through `telestar-ai-constitution.ts` & `situation-engine.ts`. |
| `app/api/ai/briefing` & `daily-briefing` | **CONSOLIDATE** | Unify under Section 13 "What Needs Attention?" Engine (`P1.1`). |
| `app/api/ai/draft-reply/route.ts` | **ENHANCE** | Bind to Section 50 Email Send Safety & Section 48 Provenance. |
| `app/api/ai/proposals/route.ts` | **RETIRE/MERGE** | Merge into commercial opportunity handoff engine. |
| `lib/ai/provider.ts` | **HARDEN** | Add strict latency telemetry, model routing tiers, and prompt caching. |
| `lib/agent/authorization.ts` | **EXTEND** | Incorporate Section 29 Autonomy Levels 0–4 & Section 30 Risk Model. |
