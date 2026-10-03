/**
 * Encode TeleStar's own ICP as a published ICP version.
 *
 * Production has scored leads against nothing, because it has no published ICP profile: every
 * lead comes back NOT SCORED however well the scoring engine works. This writes the definition
 * the business actually uses, supplied by the owner on 2026-09-22:
 *
 *   GEO        USA, Australia, Singapore, Norway, Switzerland, Denmark, Sweden, UK, Canada, Israel
 *   Industries all
 *   Verticals  Tech, Software, SaaS — excluding services and consulting
 *   Persona    Founder, CEO, COO, CRO, VP Sales, Head of Sales Dev, Head of Growth,
 *              VP Business Development, VP Growth, Head of Sales, Head of Business Development,
 *              Director of Sales, Director of Business Development
 *   Size       3 employees minimum
 *   Never qualified: one-person company; prospect on a Gmail address; offices in
 *              India/Pakistan/Bangladesh/Philippines; website offline; services/consulting product
 *
 * ## What this can and cannot enforce — read this part
 *
 * Until 2026-10-03 the publishable rule model (`normalizeManagerRules`) stripped every
 * disqualifier, so exactly one of the five survived. It now keeps them, so:
 *
 *   enforced      free-mail contact, website offline, services/consulting product, one-person
 *                 company — all as "never qualified", whatever the score
 *   enforced      min 3 employees, *when the headcount is known*; unknown size no longer holds a
 *                 lead in Review (the verdict is weighted — lib/leadgen/weightedQualification.ts)
 *   approximated  the four excluded countries go in as *HQ* exclusions. The business rule is
 *                 "has an office there", which the model has a field for
 *                 (`geography.excludedOfficeCountries`) but no lead carries office data for. A
 *                 company headquartered elsewhere with a Manila office still passes.
 *
 * Two of the enforced rules are only as good as the data behind them, and that is printed on
 * every run: "website offline" needs a website check (a missing website is not an offline one),
 * and services/consulting is read from industry and description text, not a verified company
 * type. Neither can wrongly reject a lead; both can miss one.
 *
 * ## Read before running
 *
 *   npx tsx scripts/seed-telestar-icp.ts                # report only
 *   npx tsx scripts/seed-telestar-icp.ts --apply        # create and publish
 *   npx tsx scripts/seed-telestar-icp.ts --apply --tenant=<id>
 *
 * Dry run by default. Idempotent: it updates the draft of an existing profile of the same name
 * and republishes, rather than creating a second profile. It never touches a profile it did not
 * create, and never changes which profile is default unless the tenant has no default at all.
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';
import { validateIcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';
import { normalizeManagerRules } from '@/lib/leadgen/icpManagerRules';
import type { Prisma } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const ONLY_TENANT = process.argv.find((a) => a.startsWith('--tenant='))?.slice(9);

const PROFILE_NAME = 'TeleStar ICP';
const RULE_SET_ID = 'telestar-icp-2026-09';

const TARGET_COUNTRIES = [
  'United States',
  'Australia',
  'Singapore',
  'Norway',
  'Switzerland',
  'Denmark',
  'Sweden',
  'United Kingdom',
  'Canada',
  'Israel',
];

/**
 * Approximating the office rule with an HQ rule. See the header — this is the closest the
 * publishable model gets, and it is narrower than the business rule, never wider.
 */
const EXCLUDED_COUNTRIES = ['India', 'Pakistan', 'Bangladesh', 'Philippines'];

const TITLES = [
  'Founder',
  'CEO',
  'COO',
  'CRO',
  'VP Sales',
  'Head of Sales Development',
  'Head of Growth',
  'VP Business Development',
  'VP Growth',
  'Head of Sales',
  'Head of Business Development',
  'Director of Sales',
  'Director of Business Development',
];

const MIN_EMPLOYEES = 3;

const NOT_ENFORCED = [
  'office (rather than HQ) in India / Pakistan / Bangladesh / Philippines — no lead carries office locations',
];

const DATA_LIMITED = [
  'website offline — fires only where a website check recorded the site as offline',
  'services / consulting — read from industry and description text, not a verified company type; ' +
    "LinkedIn's 'IT Services and IT Consulting' industry counts as consulting",
];

function telestarRules() {
  const rules = emptyIcpRulesV2(RULE_SET_ID, PROFILE_NAME);
  rules.geography.targetCountries = [...TARGET_COUNTRIES];
  rules.geography.excludedCountries = [...EXCLUDED_COUNTRIES];
  // All industries are in scope; the restriction TeleStar actually applies is on what the
  // company sells, which the publishable model does not carry. Claiming an industry allowlist
  // here would reject good accounts for a rule the business does not have.
  rules.industry.mode = 'all';
  rules.persona.titleAllowlist = [...TITLES];
  rules.size.minEmployees = MIN_EMPLOYEES;
  rules.disqualifiers.genericEmailContact = { disqualify: true };
  rules.disqualifiers.websiteOffline = { disqualify: true };
  rules.disqualifiers.onePersonCompany = { ...rules.disqualifiers.onePersonCompany, disqualify: true };
  rules.companyType.servicesConsultingPolicy = {
    ...rules.companyType.servicesConsultingPolicy,
    disqualify: true,
  };

  // Through the same normalizer the publish path uses, so what this script stores is exactly
  // what would survive publication — no rule that looks set here and is dropped there.
  return normalizeManagerRules(validateIcpVersionRulesV2(rules));
}

async function seedTenant(tenantId: string, tenantName: string) {
  const rules = telestarRules();

  const existing = await prisma.icpProfile.findFirst({
    where: { tenantId, name: PROFILE_NAME },
    select: { id: true },
  });
  const anyDefault = await prisma.icpProfile.findFirst({
    where: { tenantId, isDefault: true },
    select: { id: true, name: true },
  });
  const published = await prisma.icpVersion.count({ where: { tenantId, status: 'published' } });

  console.log(
    `  ${tenantName}: ${published} published version(s) today, default profile: ${anyDefault?.name ?? 'none'}.`
  );

  if (!APPLY) {
    console.log(
      `    would ${existing ? 'republish' : 'create and publish'} "${PROFILE_NAME}" ` +
        `(${TARGET_COUNTRIES.length} countries, ${TITLES.length} titles, min ${MIN_EMPLOYEES} employees)`
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    const profile =
      existing ??
      (await tx.icpProfile.create({
        data: {
          tenantId,
          name: PROFILE_NAME,
          description: "TeleStar's own ICP, as defined by the business on 2026-09-22.",
          // Only claim the default slot when nothing else holds it. Taking it from a profile
          // someone else published would silently rescore their whole pipeline.
          isDefault: !anyDefault,
        },
        select: { id: true },
      }));

    // One published version at a time per profile, matching `publishIcpDraft`.
    await tx.icpVersion.updateMany({
      where: { tenantId, icpProfileId: profile.id, status: 'published' },
      data: { status: 'archived' },
    });

    const last = await tx.icpVersion.findFirst({
      where: { tenantId, icpProfileId: profile.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    await tx.icpVersion.create({
      data: {
        tenantId,
        icpProfileId: profile.id,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        status: 'published',
        publishedAt: new Date(),
        rulesJson: rules as unknown as Prisma.InputJsonValue,
      },
    });
  });

  console.log(`    published "${PROFILE_NAME}" v${(published ?? 0) + 1}.`);
}

async function main() {
  console.log(
    APPLY
      ? 'Publishing the TeleStar ICP (WRITING).'
      : 'Publishing the TeleStar ICP (dry run — pass --apply to write).'
  );

  const tenants = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
    prisma.tenant.findMany({
      where: ONLY_TENANT ? { id: ONLY_TENANT } : undefined,
      select: { id: true, name: true },
    })
  );

  for (const tenant of tenants) {
    await tenantStorage.run({ tenantId: tenant.id }, () => seedTenant(tenant.id, tenant.name));
  }

  console.log('\nNot enforced by this ICP — no lead carries the data:');
  for (const rule of NOT_ENFORCED) console.log(`  - ${rule}`);
  console.log('Enforced, but only as good as the data behind them:');
  for (const rule of DATA_LIMITED) console.log(`  - ${rule}`);

  console.log(
    APPLY ? '\nDone. Rescore with: npx tsx scripts/backfill-lead-icp.ts --apply' : '\nDry run complete — nothing was written.'
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
