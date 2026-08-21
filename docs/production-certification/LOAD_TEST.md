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

Candidate `daa8ffb` · win32 / node 24.16.0 / postgres 16 / BullMQ mocked

| Rows | Duration | Rows/s | Chunk p50 | Chunk p95 | Chunk p99 | Leads | Accounts | Contacts | Lost | Duplicate | Heap Δ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **120** | 2.92s | 41.1 | 578ms | 792ms | 792ms | 120 | 20 | 120 | 0 | 0 | 5.23 MB |
| **500** | 10.27s | 48.69 | 853ms | 952ms | 952ms | 500 | 20 | 500 | 0 | 0 | -6.36 MB |
| **1000** | 27.08s | 36.92 | 1107ms | 1641ms | 1641ms | 1000 | 20 | 1000 | 0 | 0 | -3.51 MB |

---

## 3. `IMPORT_SYSTEM_QUEUE_BENCHMARK`

Candidate `daa8ffb` · win32 / node 24.16.0 / postgres 16 / real Redis / real BullMQ

Queue wait is measured from enqueue to the worker picking the job up; job time is the
handler's own execution once picked up.

| Rows | Chunks | Duration | Rows/s | Wait p50 | Wait p95 | Wait p99 | Job p50 | Job p95 | Job p99 | Failed | Lost | Duplicate | Stuck |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **120** | 3 | 1.21s | 99.26 | 2ms | 3ms | 3ms | 1010ms | 1055ms | 1055ms | 0 | 0 | 0 | 0 |
| **500** | 10 | 3.63s | 137.63 | 940ms | 2616ms | 2616ms | 865ms | 959ms | 959ms | 0 | 0 | 0 | 0 |
| **1000** | 20 | 6.45s | 155.11 | 2686ms | 5445ms | 5445ms | 888ms | 1013ms | 1014ms | 0 | 0 | 0 | 0 |

### What the queue measurement shows that the handler benchmark cannot

Queue wait p95 rises from 3ms at the
smallest scale to 5445ms at the
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
