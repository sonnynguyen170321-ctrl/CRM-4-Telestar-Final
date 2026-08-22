# Telestar CRM — Import Load & Scalability

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/{EV-LOAD-HANDLER,EV-LOAD-QUEUE}.json
  Regenerate: node scripts/certification/render-load-report.mjs
-->

**Requirements**: `IMP-008`, `IMP-009`, `IMP-010`
**Defects**: `TEL-P2-015` (contradictory published results), `TEL-P2-016` (queue never exercised)
**Rendered from**: EV-LOAD-HANDLER, EV-LOAD-QUEUE

---

## 1. Two benchmarks, named for what they measure

The previous report published one set of figures under a name that implied whole-system
coverage. It did not have it: BullMQ was mocked and the worker handler was called directly,
so the numbers said nothing about enqueue cost, queue wait, redelivery, retry or worker
concurrency. Both benchmarks are kept, and both are labelled honestly.

| Benchmark | What it exercises | BullMQ | Redis |
|---|---|---|---|
| `IMPORT_HANDLER_BENCHMARK` | database, Prisma, import logic, handler throughput | mocked | not used |
| `IMPORT_SYSTEM_QUEUE_BENCHMARK` | the above **plus** enqueue, queue wait, delivery, retry, worker concurrency, commit | real | real |

Neither result is "the" throughput of the system. The handler figure is an upper bound with
the queue removed; the system figure is what a real import actually costs.

---

## 2. `IMPORT_HANDLER_BENCHMARK`

Candidate `9fa36d3` · win32 / node 24.16.0 / postgres 16 / BullMQ mocked

| Rows | Duration | Rows/s | Chunk p50 | Chunk p95 | Chunk p99 | Leads | Accounts | Contacts | Lost | Duplicate | Heap Δ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **120** | 2.78s | 43.23 | 546ms | 648ms | 648ms | 120 | 20 | 120 | 0 | 0 | 1.58 MB |
| **500** | 11.42s | 43.79 | 958ms | 1081ms | 1081ms | 500 | 20 | 500 | 0 | 0 | 1.83 MB |
| **1000** | 23.89s | 41.87 | 1002ms | 1258ms | 1258ms | 1000 | 20 | 1000 | 0 | 0 | -1.39 MB |

---

## 3. `IMPORT_SYSTEM_QUEUE_BENCHMARK`

Candidate `9fa36d3` · win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ

Queue wait is measured from enqueue to the worker picking the job up; job time is the
handler's own execution once picked up.

| Rows | Chunks | Duration | Rows/s | Wait p50 | Wait p95 | Wait p99 | Job p50 | Job p95 | Job p99 | Failed | Lost | Duplicate | Stuck |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **120** | 3 | 1.41s | 85.35 | 4ms | 8ms | 8ms | 1086ms | 1183ms | 1183ms | 0 | 0 | 0 | 0 |
| **500** | 10 | 4.12s | 121.27 | 1017ms | 2905ms | 2905ms | 969ms | 1042ms | 1042ms | 0 | 0 | 0 | 0 |
| **1000** | 20 | 6.99s | 143.12 | 2879ms | 5865ms | 5865ms | 978ms | 1042ms | 1052ms | 0 | 0 | 0 | 0 |

### What the queue measurement shows that the handler benchmark cannot

Queue wait p95 rises from 8ms at the
smallest scale to 5865ms at the
largest. Jobs are enqueued far faster than a bounded worker pool drains them, so latency for
an individual chunk is dominated by waiting, not by work. The handler benchmark reports only
the work and is structurally incapable of showing this.

It is backpressure, not a fault: no rows were lost, duplicated or left stuck at any scale.

---

## 4. Data integrity across both benchmarks

- **IMPORT_HANDLER_BENCHMARK**: 3 scale(s), 0 lost row(s), 0 duplicate row(s).
- **IMPORT_SYSTEM_QUEUE_BENCHMARK**: 3 scale(s), 0 lost row(s), 0 duplicate row(s).

No throughput threshold is asserted here. The product requirements define none, and
inventing one after the fact would make the benchmark grade itself.
