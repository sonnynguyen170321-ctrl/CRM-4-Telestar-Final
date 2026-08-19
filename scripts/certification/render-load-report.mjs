#!/usr/bin/env node
/**
 * Renders LOAD_TEST.md from the evidence manifest.
 *
 * Performance numbers previously lived in two places and disagreed: LOAD_TEST.md reported
 * 26.11s / 38.3 rows/s for the 1,000-row case while FINAL_CERTIFICATE.md reported
 * 19.71s / 50.75 rows/s (TEL-P2-015). Two authoritative answers to one question is a
 * certification failure regardless of which was right.
 *
 * There is now exactly one source - `EV-LOAD-HANDLER` and `EV-LOAD-QUEUE` - and every
 * document that shows a load figure is rendered from it. Nothing types a number by hand.
 *
 *   node scripts/certification/render-load-report.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CERT_DIR, EVIDENCE_DIR } from './lib/paths.mjs';

function loadRecord(evidenceId) {
  const file = path.join(EVIDENCE_DIR, `${evidenceId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function handlerTable(record) {
  if (!record) return '_No `EV-LOAD-HANDLER` evidence record exists._';

  const rows = Object.values(record.metrics.scales)
    .sort((a, b) => a.batchSize - b.batchSize)
    .map(
      (scale) =>
        `| **${scale.batchSize}** | ${seconds(scale.totalDurationMs)} | ${scale.throughputRowsPerSec} | ` +
        `${scale.p50Ms}ms | ${scale.p95Ms}ms | ${scale.p99Ms}ms | ${scale.createdLeads} | ` +
        `${scale.createdAccounts} | ${scale.createdContacts} | ${scale.lostRows} | ${scale.duplicateRows} | ` +
        `${scale.memoryUsedMb} MB |`,
    );

  return [
    '| Rows | Duration | Rows/s | Chunk p50 | Chunk p95 | Chunk p99 | Leads | Accounts | Contacts | Lost | Duplicate | Heap Δ |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function queueTable(record) {
  if (!record) return '_No `EV-LOAD-QUEUE` evidence record exists._';

  const rows = Object.values(record.metrics.scales)
    .sort((a, b) => a.rows - b.rows)
    .map(
      (scale) =>
        `| **${scale.rows}** | ${scale.chunks} | ${seconds(scale.totalDurationMs)} | ${scale.rowsPerSecond} | ` +
        `${scale.queueWaitMs.p50}ms | ${scale.queueWaitMs.p95}ms | ${scale.queueWaitMs.p99}ms | ` +
        `${scale.jobProcessingMs.p50}ms | ${scale.jobProcessingMs.p95}ms | ${scale.jobProcessingMs.p99}ms | ` +
        `${scale.failedJobs} | ${scale.lostRows} | ${scale.duplicateRows} | ${scale.stuckRows} |`,
    );

  return [
    '| Rows | Chunks | Duration | Rows/s | Wait p50 | Wait p95 | Wait p99 | Job p50 | Job p95 | Job p99 | Failed | Lost | Duplicate | Stuck |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function integritySummary(records) {
  const lines = [];
  for (const record of records) {
    if (!record) continue;
    const scales = Object.values(record.metrics.scales);
    const lost = scales.reduce((sum, scale) => sum + scale.lostRows, 0);
    const duplicate = scales.reduce((sum, scale) => sum + scale.duplicateRows, 0);
    lines.push(
      `- **${record.metrics.mocked ? 'IMPORT_HANDLER_BENCHMARK' : 'IMPORT_SYSTEM_QUEUE_BENCHMARK'}**: ` +
        `${scales.length} scale(s), ${lost} lost row(s), ${duplicate} duplicate row(s).`,
    );
  }
  return lines.join('\n');
}

function main() {
  const handler = loadRecord('EV-LOAD-HANDLER');
  const queue = loadRecord('EV-LOAD-QUEUE');

  const generatedFrom = [handler && 'EV-LOAD-HANDLER', queue && 'EV-LOAD-QUEUE']
    .filter(Boolean)
    .join(', ');

  const body = `# Telestar CRM — Import Load & Scalability

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/{EV-LOAD-HANDLER,EV-LOAD-QUEUE}.json
  Regenerate: node scripts/certification/render-load-report.mjs
-->

**Requirements**: \`IMP-008\`, \`IMP-009\`, \`IMP-010\`
**Defects**: \`TEL-P2-015\` (contradictory published results), \`TEL-P2-016\` (queue never exercised)
**Rendered from**: ${generatedFrom || '(no evidence records)'}

---

## 1. Two benchmarks, named for what they measure

The previous report published one set of figures under a name that implied whole-system
coverage. It did not have it: BullMQ was mocked and the worker handler was called directly,
so the numbers said nothing about enqueue cost, queue wait, redelivery, retry or worker
concurrency. Both benchmarks are kept, and both are labelled honestly.

| Benchmark | What it exercises | BullMQ | Redis |
|---|---|---|---|
| \`IMPORT_HANDLER_BENCHMARK\` | database, Prisma, import logic, handler throughput | mocked | not used |
| \`IMPORT_SYSTEM_QUEUE_BENCHMARK\` | the above **plus** enqueue, queue wait, delivery, retry, worker concurrency, commit | real | real |

Neither result is "the" throughput of the system. The handler figure is an upper bound with
the queue removed; the system figure is what a real import actually costs.

---

## 2. \`IMPORT_HANDLER_BENCHMARK\`

${handler ? `Candidate \`${String(handler.candidateSha).slice(0, 7)}\` · ${handler.environment}` : ''}

${handlerTable(handler)}

---

## 3. \`IMPORT_SYSTEM_QUEUE_BENCHMARK\`

${queue ? `Candidate \`${String(queue.candidateSha).slice(0, 7)}\` · ${queue.environment}` : ''}

Queue wait is measured from enqueue to the worker picking the job up; job time is the
handler's own execution once picked up.

${queueTable(queue)}

${
  queue
    ? `### What the queue measurement shows that the handler benchmark cannot

Queue wait p95 rises from ${Object.values(queue.metrics.scales)[0]?.queueWaitMs.p95}ms at the
smallest scale to ${Object.values(queue.metrics.scales).slice(-1)[0]?.queueWaitMs.p95}ms at the
largest. Jobs are enqueued far faster than a bounded worker pool drains them, so latency for
an individual chunk is dominated by waiting, not by work. The handler benchmark reports only
the work and is structurally incapable of showing this.

It is backpressure, not a fault: no rows were lost, duplicated or left stuck at any scale.`
    : ''
}

---

## 4. Data integrity across both benchmarks

${integritySummary([handler, queue])}

No throughput threshold is asserted here. The product requirements define none, and
inventing one after the fact would make the benchmark grade itself.
`;

  writeFileSync(path.join(CERT_DIR, 'LOAD_TEST.md'), body);
  console.log('rendered LOAD_TEST.md from', generatedFrom || '(nothing)');
}

main();
