import {
  isPublicEmailDomain,
  normalizeCompanyName,
  normalizeIdentityDomain,
} from '@telestar/core-identity';

// The single place an Account is looked up or created.
//
// `@@unique([tenantId, name])` keys a company on its raw name, so "Công ty TNHH ABC",
// "CTY TNHH ABC" and "ABC Co.,Ltd" arrive as three Accounts, each holding a slice of the same
// company's leads. Import, pool conversion and research promotion each did their own
// `findUnique({ tenantId_name })`, so every one of them created duplicates independently.
//
// Resolution goes strongest key first:
//   1. canonicalDomain — two records with the same website are the same company, whatever the
//      spelling of the name.
//   2. nameNormalized — Unicode folded, diacritics stripped, Vietnamese legal forms removed.
//   3. the exact raw name, because that is what the existing unique index enforces and a plain
//      re-import must not create a second row.
//
// What it deliberately does NOT do is merge Accounts that already exist. Collapsing two rows
// silently, inside an import, would repoint other people's leads with nobody having reviewed it.
// Merging belongs to the backfill, which runs dry first and prints what it would join. This writer
// only stops NEW duplicates being created.

/**
 * The slice of a Prisma client this needs.
 *
 * Loose on purpose: the real Prisma delegate's generated signatures are far more specific than any
 * hand-written interface, so a stricter shape here would reject the actual client and force a cast
 * at every call site. Loose here, exact where it matters — the tests pass a fake with the same three
 * methods, which is what makes the resolution order testable without a database.
 */
type AccountDelegate = {
  findFirst: (args: any) => Promise<any>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
};

export type AccountIdentityDb = { account: AccountDelegate };

export type ResolveAccountInput = {
  tenantId: string;
  name: string;
  /** Any of these may carry the domain; the first that normalises wins. */
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  linkedIn?: string | null;
  country?: string | null;
  companyPhone?: string | null;
  staffCountRange?: string | null;
  staffCountMin?: number | null;
  staffCountMax?: number | null;
  size?: number | null;
};

export type ResolveAccountResult = {
  accountId: string;
  created: boolean;
  /** How the existing row was found — useful in import summaries and worth asserting in tests. */
  matchedBy: 'canonicalDomain' | 'nameNormalized' | 'name' | null;
  canonicalDomain: string | null;
  nameNormalized: string | null;
};

export function accountIdentityOf(input: Pick<ResolveAccountInput, 'name' | 'domain' | 'website'>) {
  // A public mailbox host is not a company website. Uploaded rows routinely carry "gmail.com" or
  // "yahoo.com" in a website column, and keying on it would collapse every such company into a
  // single Account — a far worse outcome than having no domain at all.
  const domainOf = (value: string | null | undefined) => {
    const normalized = normalizeIdentityDomain(value);
    return normalized && !isPublicEmailDomain(normalized) ? normalized : null;
  };

  return {
    nameNormalized: normalizeCompanyName(input.name),
    canonicalDomain: domainOf(input.domain) ?? domainOf(input.website) ?? null,
  };
}

export async function resolveAccount(
  db: AccountIdentityDb,
  input: ResolveAccountInput
): Promise<ResolveAccountResult> {
  const { tenantId } = input;
  const { nameNormalized, canonicalDomain } = accountIdentityOf(input);

  const attempts: Array<{ by: ResolveAccountResult['matchedBy']; where: Record<string, unknown> }> = [];
  if (canonicalDomain) attempts.push({ by: 'canonicalDomain', where: { tenantId, canonicalDomain } });
  if (nameNormalized) attempts.push({ by: 'nameNormalized', where: { tenantId, nameNormalized } });
  attempts.push({ by: 'name', where: { tenantId, name: input.name } });

  for (const attempt of attempts) {
    const existing = await db.account.findFirst({
      where: attempt.where,
      select: { id: true, nameNormalized: true, canonicalDomain: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!existing) continue;

    // Self-healing: a row matched by name that predates these columns gets them filled in now, so
    // the backfill has less to do and the next import matches on the stronger key.
    const patch: Record<string, string> = {};
    if (!existing.nameNormalized && nameNormalized) patch.nameNormalized = nameNormalized;
    if (!existing.canonicalDomain && canonicalDomain) patch.canonicalDomain = canonicalDomain;
    if (Object.keys(patch).length > 0) {
      await db.account.update({ where: { id: existing.id }, data: patch });
    }

    return {
      accountId: existing.id,
      created: false,
      matchedBy: attempt.by,
      canonicalDomain: existing.canonicalDomain ?? canonicalDomain,
      nameNormalized: existing.nameNormalized ?? nameNormalized,
    };
  }

  // Nothing matched, so create — but two import chunks processing rows for the same company will
  // BOTH reach this line, and the lookups above cannot prevent that. The unique index on
  // (tenantId, name) is what actually decides; whoever loses the race re-reads the winner's row.
  // Losing this convergence would lose leads under contention, which is what the import race tests
  // exist to catch.
  try {
    const created = await db.account.create({
      data: {
        name: input.name,
        nameNormalized,
        canonicalDomain,
        domain: input.domain ?? null,
        website: input.website ?? null,
        industry: input.industry ?? null,
        linkedIn: input.linkedIn ?? null,
        country: input.country ?? null,
        companyPhone: input.companyPhone ?? null,
        staffCountRange: input.staffCountRange ?? null,
        staffCountMin: input.staffCountMin ?? null,
        staffCountMax: input.staffCountMax ?? null,
        size: input.size ?? null,
        tenantId,
      },
      select: { id: true },
    });
    return { accountId: created.id, created: true, matchedBy: null, canonicalDomain, nameNormalized };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const winner = await db.account.findFirst({
      where: { tenantId, name: input.name },
      select: { id: true, nameNormalized: true, canonicalDomain: true },
    });
    if (!winner) throw error;

    return {
      accountId: winner.id,
      created: false,
      matchedBy: 'name',
      canonicalDomain: winner.canonicalDomain ?? canonicalDomain,
      nameNormalized: winner.nameNormalized ?? nameNormalized,
    };
  }
}

/** Postgres unique violation, as Prisma surfaces it. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}
