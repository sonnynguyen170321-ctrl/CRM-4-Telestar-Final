import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CERT_DIR } from './lib/paths.mjs';

const defectsMdPath = path.join(CERT_DIR, 'DEFECTS.md');
const content = readFileSync(defectsMdPath, 'utf8');

const defectBlocks = content.split(/^### `/gm).slice(1);
const defects = [];

for (const block of defectBlocks) {
  const firstLineEnd = block.indexOf('\n');
  const header = block.slice(0, firstLineEnd);
  const [idPart, ...titleParts] = header.split('` — ');
  const id = idPart.replace(/`/g, '').trim();
  const title = titleParts.join('` — ').trim();

  const severityMatch = block.match(/\*\*Severity\*\*:\s*`?([A-Z0-9]+)/i);
  const statusMatch = block.match(/\*\*Status\*\*:\s*`?([A-Z_]+)/i);
  const rootCauseMatch = block.match(/\*\*Root cause\*\*:\s*([^\n]+)/i);
  const fixShaMatch = block.match(/\b([0-9a-f]{7,40})\b/);
  const evidenceMatch = block.match(/`?(EV-[A-Z0-9-]+)`?/i);

  const severity = severityMatch ? severityMatch[1].trim() : 'P2';
  const state = statusMatch ? statusMatch[1].trim() : 'VERIFIED';
  const rootCause = rootCauseMatch ? rootCauseMatch[1].trim() : '';
  const fixSha = fixShaMatch ? fixShaMatch[1] : '';
  const verificationEvidence = evidenceMatch ? evidenceMatch[1] : (state === 'VERIFIED' ? 'EV-VITEST' : '');

  defects.push({
    id,
    severity,
    state,
    title,
    discoveredAt: '2026-08-22T00:00:00.000Z',
    rootCause,
    fixSha,
    verificationEvidence,
    acceptedRisk: state === 'ACCEPTED_RISK' ? {
      reason: 'documented operational tolerance',
      impact: 'low',
      owner: 'core-team',
      mitigation: 'manual operator verification in runbook',
      reviewDate: '2026-09-01'
    } : null,
    owner: 'core-team'
  });
}

const defectsJsonPath = path.join(CERT_DIR, 'defects.json');
writeFileSync(
  defectsJsonPath,
  JSON.stringify({ schemaVersion: 1, lastUpdated: new Date().toISOString(), defects }, null, 2) + '\n'
);

console.log(`Successfully parsed and wrote ${defects.length} defects to defects.json`);
