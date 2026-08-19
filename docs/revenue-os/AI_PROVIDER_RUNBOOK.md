# TELESTAR REVENUE DELIVERY OS — AI PROVIDER RUNBOOK

**Document Version**: 1.0.0  
**Directive**: Complete AI Transformation Master Execution Directive  
**Status**: Active Production Operations  

---

## 1. Supported AI Providers & Credentials

| Provider | Purpose | Environment Variable | Primary Models |
| :--- | :--- | :--- | :--- |
| **OpenAI** | Primary Intelligence & Tool Execution | `OPENAI_API_KEY` | `gpt-4o` (Terra), `gpt-4o-mini` (Luna), `o3-mini` (Sol) |
| **Google Vertex / Gemini** | Enterprise Fallback & Multimodal | `GEMINI_API_KEY` | `gemini-2.5-flash`, `gemini-2.5-pro` |
| **Groq** | High-Velocity Extraction & Summarization | `GROQ_API_KEY` | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` |

---

## 2. Health Check & Diagnostics

The AI Gateway exposes live operational status via `aiGateway.getHealth()`:
```typescript
import { aiGateway } from '@/lib/ai/gateway';

const health = aiGateway.getHealth();
// Returns:
// {
//   providers: { openai: true, google: true, groq: true },
//   circuits: {
//     'openai': { state: 'CLOSED', consecutiveFailures: 0, ... },
//     'groq': { state: 'CLOSED', consecutiveFailures: 0, ... }
//   }
// }
```

---

## 3. Circuit Breaker Behavior

1. **Threshold**: 3 consecutive unexpected errors or 1 rate-limit (HTTP 429) triggers `OPEN` state.
2. **Auto-Recovery**: After 30 seconds of inactivity on an open circuit, state transitions to `HALF_OPEN` to permit a canary probe.
3. **Failover**: In-flight requests automatically route to available fallbacks in priority order (`OpenAI -> Google -> Groq`).
4. **All-Provider Outage**: If all AI providers fail, the gateway gracefully returns an outage notice while core CRM and BullMQ database operations continue unaffected.
