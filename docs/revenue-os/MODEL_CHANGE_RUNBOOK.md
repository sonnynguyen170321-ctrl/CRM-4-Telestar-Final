---
classification: CURRENT_REFERENCE
note: Operational runbook.
---

# TELESTAR REVENUE DELIVERY OS — MODEL CHANGE RUNBOOK

**Document Version**: 1.0.0  
**Directive**: Complete AI Transformation Master Execution Directive  
**Status**: Active Production Operations  

---

## 1. Zero-Regression Model Upgrade Discipline

Never change a production model ID directly without completing the full promotion pipeline:

```text
DISCOVER
  ↓
BENCHMARK (Evaluation golden dataset)
  ↓
SHADOW (Asynchronous shadow inference against live traffic)
  ↓
EVALUATE (Score accuracy, grounding, tool arguments, cost, latency)
  ↓
CANARY (10% traffic allocation)
  ↓
PRODUCTION (Update Central Model Registry in lib/ai/registry.ts)
```

---

## 2. Modifying the Model Registry

All model configuration is strictly centralized in `lib/ai/registry.ts`.
Never scatter model strings or provider API keys throughout UI or service modules.

### Procedure to Add/Update a Model:
1. Define the model in `MODEL_REGISTRY` with complete metadata (`costTier`, `qualityTier`, `latencyTier`, `supportsStructuredOutput`, `supportsTools`, `fallbackPriority`).
2. Run the test suite: `npx vitest run tests/ai-gateway.test.ts`.
3. Verify type-checking: `npx tsc --noEmit`.
4. Commit to `main` with reference to the benchmark evaluation report.
