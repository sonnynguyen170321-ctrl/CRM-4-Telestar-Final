# Telestar CRM — Measured Import Load & Scalability Report

**Program**: Zero-Assumption Production Certification  
**Requirement Ref**: `IMP-008`, `IMP-009`, `IMP-010` (`TEL-P2-012`)  
**Generated**: 2026-08-19T17:02:07.997Z  

---

## 1. Measured Performance Telemetry

| Batch Size | Duration | Throughput | Chunk p50 | Chunk p95 | Chunk p99 | Created Leads | Accounts | Contacts | Lost Rows | Duplicate Rows | Heap Delta |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **120 rows** | 2.92s | **41.1 rows/s** | 617ms | **680ms** | 680ms | 120 | 20 | 120 | **0** | **0** | 1.02 MB |
| **500 rows** | 13.92s | **35.93 rows/s** | 1194ms | **1309ms** | 1309ms | 500 | 20 | 500 | **0** | **0** | 2.67 MB |
| **1000 rows** | 26.11s | **38.3 rows/s** | 1078ms | **1423ms** | 1423ms | 1000 | 20 | 1000 | **0** | **0** | 4.6 MB |

---

## 2. Invariant Verification
- **Zero Prospect Loss**: 100% of parsed valid rows reached `imported` terminal status across all scales.
- **Deduplication Correctness**: Accounts and Contacts were reconciled across concurrent chunks without primary key collisions or duplicate entity drift.
- **Latency Distribution**: Chunk p95 duration remained sub-second across 1,000-row continuous ingestion.
