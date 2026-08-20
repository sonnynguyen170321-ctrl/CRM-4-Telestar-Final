---
classification: CURRENT_REFERENCE
note: Security reference.
---

# TELESTAR REVENUE DELIVERY OS — SECURITY & ISOLATION SPECIFICATION

**Document Version**: 1.0.0  
**Directive**: Complete AI Transformation Master Execution Directive  
**Status**: Canonical Production Security  

---

## 1. Security Architecture Principles

1. **Deterministic RBAC & Multi-Tenant Boundaries**: AI cannot grant permissions or bypass multi-tenant RLS boundaries.
2. **External Content as Untrusted Data**: Inbound prospect emails and external websites are sanitized into `[UNTRUSTED_EXTERNAL_DATA]` blocks, preventing prompt injection.
3. **Durable Tool Idempotency Keys**: All tool writes carry deterministic logical deduplication keys (`tenantId:userId:executionId:turnId:toolOrdinal:toolName`).
4. **Fail-Closed Fallback Secrets**: Secret resolution fails closed in production; no hardcoded default secrets exist.
5. **No Employee Surveillance**: AI coaching models focus purely on skills development (objections, discovery, follow-up discipline) without keystroke or intrusive surveillance.
