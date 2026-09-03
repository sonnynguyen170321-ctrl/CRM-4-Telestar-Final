import { normalizeLinkedIn, normalizePhone } from '@/lib/leads/normalize';
import { normalizeCompanyName, normalizeIdentityText } from '@telestar/core-identity';

import { accountIdentityOf } from './resolveAccount';

// Identity backfill — phase 2.
//
// Phase 1 (migration `20260902000000_identity_phase1`) added the columns, nullable, and taught the
// writers to fill them going forward. Every row that existed before that is still keyed on a raw
// company name, which is how "Công ty TNHH ABC", "CTY TNHH ABC" and "ABC Co.,Ltd" became three
// Accounts with a third of the history each.
//
// This computes the identity columns for those rows, merges the duplicates they reveal, and links
// contacts to the account they actually work for. It is the step that has to run before
// `(tenantId, canonicalDomain)` can be made unique.
//
// It is one-way on real data. Dry run is the default, the report names every merge before any of it
// happens, and a snapshot is the precondition for `--apply`.

export type MergePlan = {
  /** The account that survives, and why it was chosen. */
  survivorId: string;
  survivorName: string;
  reason: 'has_domain' | 'most_leads' | 'oldest';
  key: string;
  losers: Array<{ id: string; name: string; leads: number; contacts: number }>;
};

export type BackfillReport = {
  tenantId: string | null;
  dryRun: boolean;
  accountsScanned: number;
  accountsStamped: number;
  mergePlans: MergePlan[];
  accountsMerged: number;
  contactsLinked: number;
  employmentsCreated: number;
  contactsRenormalized: number;
  leadsRenormalized: number;
  poolItemsRenormalized: number;
};

type Db = {
  account: any;
  contact: any;
  contactEmployment: any;
  lead: any;
  leadPoolItem: any;
  opportunity: any;
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

/** Bounded so one invocation cannot walk an unbounded table in a single transaction. */
const PAGE = 500;

export async function backfillAccountIdentity(params: {
  db: Db;
  tenantId?: string | null;
  dryRun?: boolean;
}): Promise<BackfillReport> {
  const { db } = params;
  const tenantId = params.tenantId ?? null;
  const dryRun = params.dryRun !== false;
  const where = tenantId ? { tenantId } : {};

  const report: BackfillReport = {
    tenantId,
    dryRun,
    accountsScanned: 0,
    accountsStamped: 0,
    mergePlans: [],
    accountsMerged: 0,
    contactsLinked: 0,
    employmentsCreated: 0,
    contactsRenormalized: 0,
    leadsRenormalized: 0,
    poolItemsRenormalized: 0,
  };

  // ── 1. Stamp the identity columns ────────────────────────────────────────────────────────────
  const accounts = await db.account.findMany({
    where,
    select: {
      id: true, tenantId: true, name: true, website: true, domain: true,
      nameNormalized: true, canonicalDomain: true, createdAt: true,
      _count: { select: { leads: true, contacts: true } },
    },
  });
  report.accountsScanned = accounts.length;

  const stamped = accounts.map((account: any) => {
    const identity = accountIdentityOf({
      name: account.name,
      domain: account.domain ?? null,
      website: account.website ?? null,
    });
    const needsStamp =
      account.nameNormalized !== identity.nameNormalized ||
      account.canonicalDomain !== identity.canonicalDomain;
    if (needsStamp) report.accountsStamped += 1;
    return { ...account, ...identity, needsStamp };
  });

  if (!dryRun) {
    for (const account of stamped.filter((a: any) => a.needsStamp)) {
      await db.account.updateMany({
        where: { id: account.id, tenantId: account.tenantId },
        data: { nameNormalized: account.nameNormalized, canonicalDomain: account.canonicalDomain },
      });
    }
  }

  // ── 2. Plan the merges ───────────────────────────────────────────────────────────────────────
  //
  // Two rows belong together when they share a canonical domain, or when they share a normalised
  // name and nothing contradicts it. Grouping on the domain key alone was not enough: the ordinary
  // shape of this data is one row carrying the website and two spellings of the same name carrying
  // none, and a domain-keyed group leaves the row that has the domain sitting on its own.
  //
  // The contradiction rule is what keeps that safe. If a name group contains two different domains,
  // those are two real companies that happen to share a generic name, and the name is not evidence.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const seen = parent.get(id) ?? id;
    if (seen === id) return id;
    const root = find(seen);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  const byDomain = new Map<string, any[]>();
  const byName = new Map<string, any[]>();
  for (const account of stamped) {
    if (account.canonicalDomain) {
      const key = `${account.tenantId}|${account.canonicalDomain}`;
      byDomain.set(key, [...(byDomain.get(key) ?? []), account]);
    }
    if (account.nameNormalized) {
      const key = `${account.tenantId}|${account.nameNormalized}`;
      byName.set(key, [...(byName.get(key) ?? []), account]);
    }
  }

  for (const members of byDomain.values()) {
    for (const member of members.slice(1)) union(members[0].id, member.id);
  }
  for (const members of byName.values()) {
    const domains = new Set(members.map((m: any) => m.canonicalDomain).filter(Boolean));
    if (domains.size > 1) continue; // two companies, one generic name — the domains say so
    for (const member of members.slice(1)) union(members[0].id, member.id);
  }

  const components = new Map<string, any[]>();
  for (const account of stamped) {
    if (!account.canonicalDomain && !account.nameNormalized) continue;
    const root = find(account.id);
    components.set(root, [...(components.get(root) ?? []), account]);
  }

  for (const members of components.values()) {
    if (members.length < 2) continue;

    // The survivor is the row with the most evidence behind it: a domain first, then the most leads,
    // then the oldest — so a merge is reproducible rather than dependent on row order.
    const ranked = [...members].sort((a: any, b: any) => {
      if (Boolean(a.canonicalDomain) !== Boolean(b.canonicalDomain)) return a.canonicalDomain ? -1 : 1;
      if (b._count.leads !== a._count.leads) return b._count.leads - a._count.leads;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const [survivor, ...losers] = ranked;

    report.mergePlans.push({
      survivorId: survivor.id,
      survivorName: survivor.name,
      reason: survivor.canonicalDomain
        ? 'has_domain'
        : survivor._count.leads > 0
          ? 'most_leads'
          : 'oldest',
      key: survivor.canonicalDomain
        ? `${survivor.tenantId}|domain:${survivor.canonicalDomain}`
        : `${survivor.tenantId}|name:${survivor.nameNormalized}`,
      losers: losers.map((l: any) => ({
        id: l.id,
        name: l.name,
        leads: l._count.leads,
        contacts: l._count.contacts,
      })),
    });
  }

  if (!dryRun) {
    for (const plan of report.mergePlans) {
      const loserIds = plan.losers.map((l) => l.id);
      const survivor = stamped.find((a: any) => a.id === plan.survivorId);

      // Repoint everything, then delete — in one transaction, because a half-merged account is worse
      // than an un-merged one: the history is split and nothing says where the rest went.
      await db.$transaction(async (tx: any) => {
        const scope = { tenantId: survivor.tenantId, accountId: { in: loserIds } };
        await tx.lead.updateMany({ where: scope, data: { accountId: plan.survivorId } });
        await tx.leadPoolItem.updateMany({ where: scope, data: { accountId: plan.survivorId } });
        await tx.opportunity.updateMany({ where: scope, data: { accountId: plan.survivorId } });
        await tx.contact.updateMany({ where: scope, data: { accountId: plan.survivorId } });
        await tx.contactEmployment.updateMany({ where: scope, data: { accountId: plan.survivorId } });
        await tx.account.deleteMany({ where: { tenantId: survivor.tenantId, id: { in: loserIds } } });
      });
      report.accountsMerged += loserIds.length;
    }
  } else {
    report.accountsMerged = report.mergePlans.reduce((sum, plan) => sum + plan.losers.length, 0);
  }

  // ── 3. Link contacts to their account ────────────────────────────────────────────────────────
  const survivingAccounts = await db.account.findMany({
    where,
    select: { id: true, tenantId: true, nameNormalized: true },
  });
  const accountByName = new Map<string, string>();
  for (const account of survivingAccounts) {
    if (account.nameNormalized) accountByName.set(`${account.tenantId}|${account.nameNormalized}`, account.id);
  }

  let cursor: string | undefined;
  for (;;) {
    const contacts = await db.contact.findMany({
      where,
      select: {
        id: true, tenantId: true, company: true, accountId: true, firstName: true, lastName: true,
        fullNameNormalized: true, normalizedCompany: true, normalizedPhone: true,
        normalizedLinkedIn: true, phone: true, linkedIn: true, title: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (contacts.length === 0) break;
    cursor = contacts[contacts.length - 1].id;

    for (const contact of contacts) {
      const normalizedCompany = normalizeCompanyName(contact.company);
      const accountId =
        contact.accountId ??
        (normalizedCompany ? accountByName.get(`${contact.tenantId}|${normalizedCompany}`) ?? null : null);

      const fullNameNormalized = normalizeIdentityText(
        [contact.firstName, contact.lastName].filter(Boolean).join(' ')
      );
      // The normalisers changed with phase 1 — old rows hold the pre-change forms, so an old row and a
      // new row for the same person would not match until these are recomputed.
      const normalizedPhone = normalizePhone(contact.phone);
      const normalizedLinkedIn = normalizeLinkedIn(contact.linkedIn);

      const changed =
        contact.accountId !== accountId ||
        contact.normalizedCompany !== normalizedCompany ||
        contact.fullNameNormalized !== fullNameNormalized ||
        contact.normalizedPhone !== normalizedPhone ||
        contact.normalizedLinkedIn !== normalizedLinkedIn;

      if (!changed) continue;
      report.contactsRenormalized += 1;
      if (accountId && !contact.accountId) report.contactsLinked += 1;

      if (dryRun) continue;

      await db.contact.updateMany({
        where: { id: contact.id, tenantId: contact.tenantId },
        data: {
          accountId,
          normalizedCompany,
          fullNameNormalized,
          normalizedPhone,
          normalizedLinkedIn,
        },
      });

      if (accountId) {
        // The employment row is the durable fact "this person worked here"; `Contact.accountId` is
        // only the current employer. Created as current, since that is what the CRM believed.
        const existing = await db.contactEmployment.findFirst({
          where: { tenantId: contact.tenantId, contactId: contact.id, accountId },
          select: { id: true },
        });
        if (!existing) {
          await db.contactEmployment.create({
            data: {
              tenantId: contact.tenantId,
              contactId: contact.id,
              accountId,
              title: contact.title ?? null,
              isCurrent: true,
            },
          });
          report.employmentsCreated += 1;
        }
      }
    }
  }

  // ── 4. Re-normalise the rows the writers key on ──────────────────────────────────────────────
  report.leadsRenormalized = await renormalizeLeads(db, where, dryRun);
  report.poolItemsRenormalized = await renormalizePoolItems(db, where, dryRun);

  return report;
}

async function renormalizeLeads(db: Db, where: object, dryRun: boolean): Promise<number> {
  let changed = 0;
  let cursor: string | undefined;
  for (;;) {
    const leads = await db.lead.findMany({
      where,
      select: { id: true, tenantId: true, phone: true, linkedIn: true, normalizedPhone: true, normalizedLinkedIn: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (leads.length === 0) break;
    cursor = leads[leads.length - 1].id;

    for (const lead of leads) {
      const normalizedPhone = normalizePhone(lead.phone);
      const normalizedLinkedIn = normalizeLinkedIn(lead.linkedIn);
      if (lead.normalizedPhone === normalizedPhone && lead.normalizedLinkedIn === normalizedLinkedIn) continue;
      changed += 1;
      if (dryRun) continue;
      await db.lead.updateMany({
        where: { id: lead.id, tenantId: lead.tenantId },
        data: { normalizedPhone, normalizedLinkedIn },
      });
    }
  }
  return changed;
}

async function renormalizePoolItems(db: Db, where: object, dryRun: boolean): Promise<number> {
  let changed = 0;
  let cursor: string | undefined;
  for (;;) {
    const items = await db.leadPoolItem.findMany({
      where,
      select: { id: true, tenantId: true, company: true, normalizedCompany: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (items.length === 0) break;
    cursor = items[items.length - 1].id;

    for (const item of items) {
      const normalizedCompany = normalizeCompanyName(item.company);
      if (item.normalizedCompany === normalizedCompany) continue;
      changed += 1;
      if (dryRun) continue;
      await db.leadPoolItem.updateMany({
        where: { id: item.id, tenantId: item.tenantId },
        data: { normalizedCompany },
      });
    }
  }
  return changed;
}

/** The merge plan as CSV, so the report can be read before anything is written. */
export function mergePlansToCsv(plans: MergePlan[]): string {
  const rows = [['survivorId', 'survivorName', 'reason', 'key', 'loserId', 'loserName', 'loserLeads', 'loserContacts']];
  for (const plan of plans) {
    for (const loser of plan.losers) {
      rows.push([
        plan.survivorId, plan.survivorName, plan.reason, plan.key,
        loser.id, loser.name, String(loser.leads), String(loser.contacts),
      ]);
    }
  }
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}
