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

Candidate `396d365` · win32 / node 24.16.0 / postgres 16 / BullMQ mocked

| Rows | Duration | Rows/s | Chunk p50 | Chunk p95 | Chunk p99 | Leads | Accounts | Contacts | Lost | Duplicate | Heap Δ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **120** | 13.12s | 9.15 | 2463ms | 3183ms | 3183ms | 120 | 20 | 120 | 0 | 0 | -8.62 MB |
| **500** | 56.72s | 8.81 | 5113ms | 5490ms | 5490ms | 500 | 20 | 500 | 0 | 0 | 4.58 MB |
| **1000** | 170.81s | 5.85 | 6561ms | 12159ms | 12159ms | 1000 | 20 | 1000 | 0 | 0 | 1.97 MB |

---

## 3. `IMPORT_SYSTEM_QUEUE_BENCHMARK`

Candidate `396d365` · win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ

Queue wait is measured from enqueue to the worker picking the job up; job time is the
handler's own execution once picked up.

| Rows | Chunks | Duration | Rows/s | Wait p50 | Wait p95 | Wait p99 | Job p50 | Job p95 | Job p99 | Failed | Lost | Duplicate | Stuck |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **120** | 3 | 3.93s | 30.5 | 5ms | 8ms | 8ms | 3649ms | 3711ms | 3711ms | 0 | 0 | 0 | 0 |
| **500** | 10 | 30.10s | 16.61 | 15235ms | 27656ms | 27656ms | 9480ms | 15291ms | 15291ms | 0 | 0 | 0 | 0 |
| **1000** | 20 | 14.28s | 70.05 | 6032ms | 12133ms | 12133ms | 2018ms | 2171ms | 2199ms | 0 | 0 | 0 | 0 |

### What the queue measurement shows that the handler benchmark cannot

Queue wait p95 rises from 8ms at the
smallest scale to 12133ms at the
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
