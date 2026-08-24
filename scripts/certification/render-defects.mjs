#!/usr/bin/env node
/**
 * Renders DEFECTS.md from authoritative defects.json (Section 11).
 *
 *   node scripts/certification/render-defects.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CERT_DIR } from './lib/paths.mjs';

const defectsJsonPath = path.join(CERT_DIR, 'defects.json');
const defectsData = JSON.parse(readFileSync(defectsJsonPath, 'utf8'));
const defects = defectsData.defects || [];

const p0List = defects.filter((d) => d.severity === 'P0');
const p1List = defects.filter((d) => d.severity === 'P1');
const p2List = defects.filter((d) => d.severity === 'P2');
const p3List = defects.filter((d) => d.severity === 'P3');

const countByState = (list) => {
  const active = list.filter((d) => ['OPEN', 'IN_PROGRESS', 'FIXED_PENDING_VERIFICATION'].includes(d.state)).length;
  const verified = list.filter((d) => d.state === 'VERIFIED').length;
  const accepted = list.filter((d) => d.state === 'ACCEPTED_RISK').length;
  return { active, verified, accepted, total: list.length };
};

const p0Stats = countByState(p0List);
const p1Stats = countByState(p1List);
const p2Stats = countByState(p2List);
const p3Stats = countByState(p3List);

let md = `# Telestar CRM — Master Defect Database

**Program**: Telestar Production Certification
**Authoritative Source**: \`docs/production-certification/defects.json\`
**Last Updated**: ${defectsData.lastUpdated || new Date().toISOString()}

> **Closure rule.** A defect moves \`OPEN → IN_PROGRESS → FIXED_PENDING_VERIFICATION → VERIFIED\`
> only. \`VERIFIED\` requires: root cause, fix SHA, the specific test, the actual run result, and
> an evidence record ID under \`docs/production-certification/evidence/\`. "Fix implemented" is
> **not** \`VERIFIED\`.

---

## 1. Defect Summary

| Severity | Discovered | Verified Closed | Accepted Risk | Active / Open |
|---|---|---|---|---|
| **P0** (Launch Blocker) | ${p0Stats.total} | ${p0Stats.verified} | ${p0Stats.accepted} | **${p0Stats.active}** |
| **P1** (Critical) | ${p1Stats.total} | ${p1Stats.verified} | ${p1Stats.accepted} | **${p1Stats.active}** |
| **P2** (Important) | ${p2Stats.total} | ${p2Stats.verified} | ${p2Stats.accepted} | **${p2Stats.active}** |
| **P3** (Minor Polish) | ${p3Stats.total} | ${p3Stats.verified} | ${p3Stats.accepted} | **${p3Stats.active}** |
| **TOTAL** | **${defects.length}** | **${p0Stats.verified + p1Stats.verified + p2Stats.verified + p3Stats.verified}** | **${p0Stats.accepted + p1Stats.accepted + p2Stats.accepted + p3Stats.accepted}** | **${p0Stats.active + p1Stats.active + p2Stats.active + p3Stats.active}** |

---

## 2. Defects Ledger

`;

for (const d of defects) {
  md += `### \`${d.id}\` — ${d.title}

- **Severity**: ${d.severity}
- **Status**: \`${d.state}\`
- **Owner**: ${d.owner || 'core-team'}
- **Discovered**: ${d.discoveredAt}
- **Root cause**: ${d.rootCause || 'N/A'}
- **Fix SHA**: \`${d.fixSha || 'N/A'}\`
- **Verification evidence**: \`${d.verificationEvidence || 'N/A'}\`
${d.acceptedRisk ? `- **Accepted risk**: ${JSON.stringify(d.acceptedRisk)}\n` : ''}
`;
}

const defectsMdPath = path.join(CERT_DIR, 'DEFECTS.md');
writeFileSync(defectsMdPath, md);
console.log(`Rendered DEFECTS.md from defects.json (${defects.length} entries)`);
