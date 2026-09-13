import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findGaps, parseCoverage, parseModels, sensitiveColumns } from '@/scripts/check-sanitize-coverage.mjs';

// deploy/hostinger/backup.sh --sanitize writes a file called `.sanitized.dump`, and that label is
// what makes an operator willing to copy production data to a laptop. The first version of
// sanitize.sql scrubbed the obvious email/phone/token columns and left note bodies, audit-log
// JSON diffs, raw import rows and HTML mail bodies untouched — a dump that is labelled safe and
// is not. This test is the mechanism that stops that recurring: the candidate list comes from
// prisma/schema.prisma, so a migration that adds a personal-data column fails here until someone
// either scrubs it or writes down why it is safe.

const ROOT = join(__dirname, '..');
const schemaText = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const sqlText = readFileSync(join(ROOT, 'deploy', 'hostinger', 'sanitize.sql'), 'utf8');
const exemptionsFile = JSON.parse(
  readFileSync(join(ROOT, 'deploy', 'hostinger', 'sanitize-exemptions.json'), 'utf8')
) as { exemptions: Record<string, Record<string, string>> };

describe('sanitize.sql covers every sensitive column in the schema', () => {
  it('leaves no personal-data column unscrubbed and unexplained', () => {
    const { gaps } = findGaps({ schemaText, sqlText, exemptions: exemptionsFile.exemptions });
    const rendered = gaps.map((g) => `${g.model}.${g.column} (${g.kind})`);
    expect(
      rendered,
      'Scrub these in deploy/hostinger/sanitize.sql, or record why they are safe in sanitize-exemptions.json'
    ).toEqual([]);
  });

  it('every exemption names a real column and carries a reason', () => {
    const models = parseModels(schemaText);
    const problems: string[] = [];
    for (const [model, columns] of Object.entries(exemptionsFile.exemptions)) {
      const known = models.get(model);
      if (!known) {
        problems.push(`${model} is not a model — stale exemption`);
        continue;
      }
      for (const [column, reason] of Object.entries(columns)) {
        if (!known.some((c: { column: string }) => c.column === column)) {
          problems.push(`${model}.${column} no longer exists`);
        }
        // A one-word "safe" is not a reason. The point of the file is the judgement, not the key.
        if (reason.trim().length < 40) problems.push(`${model}.${column} reason is too short to be one`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('exempts nothing that the scrub also assigns', () => {
    // An entry that duplicates an UPDATE is dead weight and misleads the next reader into
    // thinking the column is deliberately kept.
    const covered = parseCoverage(sqlText);
    const redundant: string[] = [];
    for (const [model, columns] of Object.entries(exemptionsFile.exemptions)) {
      for (const column of Object.keys(columns)) {
        if (covered.get(model)?.has(column)) redundant.push(`${model}.${column}`);
      }
    }
    expect(redundant).toEqual([]);
  });

  it('recognises the shapes that matter', () => {
    // Guards the classifier itself: if the regexes stop matching, every gap silently disappears
    // and this suite goes green while covering nothing.
    const sensitive = sensitiveColumns(parseModels(schemaText));
    const names = new Set(sensitive.map((c) => `${c.model}.${c.column}`));
    for (const expected of [
      'Note.content',
      'AuditLog.changedFields',
      'ImportRow.data',
      'InboundMessage.bodyHtml',
      'EmailAccount.encAccessToken',
      'Contact.email',
      'User.password',
    ]) {
      expect(names, `${expected} must be classified sensitive`).toContain(expected);
    }
    expect(sensitive.length).toBeGreaterThan(50);
  });
});
