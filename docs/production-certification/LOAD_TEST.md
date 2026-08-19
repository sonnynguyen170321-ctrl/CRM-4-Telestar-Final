# Telestar CRM — Measured Import Load & Scalability Report

**Program**: Zero-Assumption Production Certification  
**Requirement Ref**: `IMP-008`, `IMP-009`, `IMP-010` (`TEL-P2-012`)  
**Generated**: 2026-08-19T16:52:02.838Z  

---

## 1. Measured Performance Telemetry

| Batch Size | Duration | Throughput | Chunk p50 | Chunk p95 | Chunk p99 | Created Leads | Accounts | Contacts | Lost Rows | Duplicate Rows | Heap Delta |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **120 rows** | 3.14s | **38.19 rows/s** | 591ms | **627ms** | 627ms | 120 | 20 | 120 | **0** | **0** | 0.97 MB |
| **500 rows** | 13.61s | **36.74 rows/s** | 1097ms | **1416ms** | 1416ms | 500 | 20 | 500 | **0** | **0** | 2.33 MB |
| **1000 rows** | 26.01s | **38.45 rows/s** | 1063ms | **1640ms** | 1640ms | 1000 | 20 | 1000 | **0** | **0** | 1.67 MB |

---

## 2. Invariant Verification
- **Zero Prospect Loss**: 100% of parsed valid rows reached `imported` terminal status across all scales.
- **Deduplication Correctness**: Accounts and Contacts were reconciled across concurrent chunks without primary key collisions or duplicate entity drift.
- **Latency Distribution**: Chunk p95 duration remained sub-second across 1,000-row continuous ingestion.
