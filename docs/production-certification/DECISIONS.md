# Telestar CRM — Master Architectural Decision Log

**Program**: Telestar Production Certification  

---

### DEC-001: Encapsulation of Object Authorization in Domain Services
- **Date**: 2026-08-19
- **Decision**: AI agent tools (`lib/ai/tools.ts`) must never query CRM tables directly (e.g. `prisma.lead`, `prisma.contact`). All lookups must delegate to domain services (`lib/contact-intelligence/service.ts`) to ensure single-authority multi-tenant scoping and avoid auth drift.

### DEC-002: Provider-Neutral AI Gateway Architecture
- **Date**: 2026-08-19
- **Decision**: All model generation passes through `lib/ai/gateway.ts` with circuit-breaker protection, token rate limit failover (Groq -> Gemini), and structured ledger recording (`AiCall`).

### DEC-003: Import Worker Batch Reconciliation & Concurrency
- **Date**: 2026-08-19
- **Decision**: The import worker processes chunks with explicit upsert collision handling and independent row error capture, eliminating long-running interactive transaction timeouts under high concurrency.
