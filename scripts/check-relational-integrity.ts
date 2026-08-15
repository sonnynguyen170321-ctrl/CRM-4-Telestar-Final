/**
 * Read-only relational-integrity diagnostic.
 *
 * A row's own `tenantId` being correct does not make the rows it *points at* correct. Postgres
 * enforces that a foreign key references something; it does not enforce that the something is in
 * the same tenant, and RLS governs row visibility rather than referential consistency. Two
 * request-controlled paths were found writing exactly that shape before validation landed:
 *
 *   - `Lead.campaignId` naming another tenant's campaign (fixed in `b532177`)
 *   - `BookingLink.clientId` / `campaignId` naming another tenant's client and campaign,
 *     which `GET /api/booking-links` then disclosed by name (fixed in `4e90e07`)
 *
 * Both writes are closed. Rows written *before* those fixes are not, and nothing so far proves
 * whether any exist outside tests. This is how staging or production answers that.
 *
 * It also covers a mismatch that is not a tenancy question at all: a BookingLink whose campaign
 * belongs to a different client than the link claims. Same tenant, both references legitimate,
 * hierarchy incoherent — and every report walking `lead -> campaign -> client` would disagree
 * with it.
 *
 * **Reports only.** No repair, no deletion, no reassignment. Deciding what a poisoned row should
 * become needs a human who knows which side is right, and an automatic "fix" here could quietly
 * move a real client's booking link to the wrong company.
 *
 *   npx tsx scripts/check-relational-integrity.ts
 *   npx tsx scripts/check-relational-integrity.ts --json
 *
 * Exit code is 1 when any inconsistency is found, so it can gate a deploy step.
 */
import { PrismaClient } from '@prisma/client';

/** Ids and tenant ids only — enough to investigate, no names, emails or URLs. */
interface Finding {
  id: string;
  tenantId: string;
  relationId: string | null;
  relationTenantId: string | null;
}

interface Check {
  key: string;
  title: string;
  detail: string;
  run: (db: PrismaClient) => Promise<Finding[]>;
}

const CHECKS: Check[] = [
  {
    key: 'lead_campaign_tenant',
    title: 'Lead.tenantId != Campaign.tenantId',
    detail:
      'A lead attached to another tenant\'s campaign. The write path was fixed in b532177; ' +
      'rows older than that fix can still carry it.',
    run: (db) => db.$queryRaw<Finding[]>`
      SELECT l.id, l."tenantId", c.id AS "relationId", c."tenantId" AS "relationTenantId"
      FROM "Lead" l
      JOIN "Campaign" c ON c.id = l."campaignId"
      WHERE c."tenantId" <> l."tenantId"
      ORDER BY l."tenantId", l.id
    `,
  },
  {
    key: 'bookinglink_client_tenant',
    title: 'BookingLink.tenantId != Client.tenantId',
    detail:
      'A booking link attached to another tenant\'s client. This is the one that reaches a ' +
      'prospect: the link is the URL they are sent to book a meeting.',
    run: (db) => db.$queryRaw<Finding[]>`
      SELECT b.id, b."tenantId", c.id AS "relationId", c."tenantId" AS "relationTenantId"
      FROM "BookingLink" b
      JOIN "Client" c ON c.id = b."clientId"
      WHERE c."tenantId" <> b."tenantId"
      ORDER BY b."tenantId", b.id
    `,
  },
  {
    key: 'bookinglink_campaign_tenant',
    title: 'BookingLink.tenantId != Campaign.tenantId',
    detail: 'A booking link scoped to another tenant\'s campaign.',
    run: (db) => db.$queryRaw<Finding[]>`
      SELECT b.id, b."tenantId", c.id AS "relationId", c."tenantId" AS "relationTenantId"
      FROM "BookingLink" b
      JOIN "Campaign" c ON c.id = b."campaignId"
      WHERE b."campaignId" IS NOT NULL AND c."tenantId" <> b."tenantId"
      ORDER BY b."tenantId", b.id
    `,
  },
  {
    key: 'bookinglink_hierarchy',
    title: 'BookingLink.campaign.clientId != BookingLink.clientId',
    detail:
      'Not a tenancy fault. The link claims one client while its campaign belongs to another, ' +
      'so the two describe different hierarchies even when both rows are legitimate.',
    run: (db) => db.$queryRaw<Finding[]>`
      SELECT b.id, b."tenantId", c.id AS "relationId", c."clientId" AS "relationTenantId"
      FROM "BookingLink" b
      JOIN "Campaign" c ON c.id = b."campaignId"
      WHERE b."campaignId" IS NOT NULL AND c."clientId" <> b."clientId"
      ORDER BY b."tenantId", b.id
    `,
  },
];

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const db = new PrismaClient();

  try {
    const results: Array<{ check: Check; findings: Finding[] }> = [];
    for (const check of CHECKS) {
      results.push({ check, findings: await check.run(db) });
    }

    const total = results.reduce((n, r) => n + r.findings.length, 0);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            total,
            checks: results.map((r) => ({
              key: r.check.key,
              title: r.check.title,
              count: r.findings.length,
              findings: r.findings,
            })),
          },
          null,
          2
        )
      );
    } else {
      console.log('\nRelational integrity — cross-tenant and hierarchy references\n');
      for (const { check, findings } of results) {
        console.log(`${findings.length === 0 ? 'ok  ' : 'FAIL'}  ${check.title}  (${findings.length})`);
        if (findings.length > 0) {
          console.log(`      ${check.detail}`);
          for (const f of findings.slice(0, 20)) {
            console.log(
              `      row ${f.id} [${f.tenantId}] -> ${f.relationId} [${f.relationTenantId}]`
            );
          }
          if (findings.length > 20) console.log(`      … and ${findings.length - 20} more`);
        }
      }
      console.log(
        total === 0
          ? '\nNo inconsistent references found.\n'
          : `\n${total} inconsistent reference(s). Nothing has been changed — deciding which side ` +
              'is correct needs someone who knows the data.\n'
      );
    }

    process.exit(total === 0 ? 0 : 1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('[check-relational-integrity] failed:', err);
  process.exit(2);
});
