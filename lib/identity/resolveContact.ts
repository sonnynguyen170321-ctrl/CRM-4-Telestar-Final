import { normalizeCompanyName, normalizeIdentityText } from '@telestar/core-identity';

import { normalizeEmail, normalizeLinkedIn, normalizePhone } from '@/lib/leads/normalize';

// The single place a Contact is looked up or created, and the only place a contact is linked to an
// Account.
//
// Before this, a contact's only tie to a company was the free-text `company` column, so "who works
// at this account" could not be answered without matching strings, and the same person at a renamed
// employer looked like two people. `accountId` is the fact; `company` stays as the label that came
// in on the row.
//
// Resolution goes strongest identifier first — email, then phone, then LinkedIn — before falling
// back to a person's name within one account. The fallback is scoped to the account on purpose:
// "Nguyen Van A" is not a unique human, and matching on name alone across a tenant would merge
// different people.

export type ContactIdentityDb = {
  contact: {
    findFirst: (args: unknown) => Promise<{ id: string; accountId: string | null } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
    update: (args: unknown) => Promise<unknown>;
  };
  contactEmployment: {
    upsert: (args: unknown) => Promise<unknown>;
  };
};

export type ResolveContactInput = {
  tenantId: string;
  accountId: string;
  /** The employer label as it arrived, kept for display. */
  company: string;
  firstName: string;
  lastName: string;
  fullName?: string | null;
  email: string;
  title?: string | null;
  department?: string | null;
  seniority?: string | null;
  country?: string | null;
  phone?: string | null;
  secondaryPhone?: string | null;
  linkedIn?: string | null;
  whatsApp?: string | null;
  emailValidation?: string | null;
  emailScore?: number | null;
  alternateEmail?: string | null;
  alternateEmailValidation?: string | null;
};

export type ResolveContactResult = {
  contactId: string;
  created: boolean;
  matchedBy: 'email' | 'phone' | 'linkedin' | 'name_in_account' | null;
};

export async function resolveContact(
  db: ContactIdentityDb,
  input: ResolveContactInput
): Promise<ResolveContactResult> {
  const { tenantId, accountId } = input;
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedPhone = normalizePhone(input.phone);
  const normalizedLinkedIn = normalizeLinkedIn(input.linkedIn);
  const normalizedCompany = normalizeCompanyName(input.company);
  const fullName = input.fullName || `${input.firstName} ${input.lastName}`.trim();
  // A person's name is folded, not company-normalised: `normalizeCompanyName` strips Vietnamese
  // legal forms, which would quietly mangle a human called Cường or Công.
  const fullNameNormalized = normalizeIdentityText(fullName);

  const attempts: Array<{ by: ResolveContactResult['matchedBy']; where: Record<string, unknown> }> = [];
  if (normalizedEmail) attempts.push({ by: 'email', where: { tenantId, normalizedEmail } });
  if (normalizedPhone) attempts.push({ by: 'phone', where: { tenantId, normalizedPhone } });
  if (normalizedLinkedIn) attempts.push({ by: 'linkedin', where: { tenantId, normalizedLinkedIn } });
  if (fullNameNormalized) {
    attempts.push({ by: 'name_in_account', where: { tenantId, accountId, fullNameNormalized } });
  }

  for (const attempt of attempts) {
    const existing = await db.contact.findFirst({
      where: attempt.where,
      select: { id: true, accountId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!existing) continue;

    // A contact found by email may predate the account link, or may have changed employer. Either
    // way the current employer is the one on this row.
    await db.contact.update({
      where: { id: existing.id },
      data: {
        accountId,
        company: input.company,
        normalizedCompany,
        fullNameNormalized,
        ...(input.title ? { title: input.title } : {}),
      },
    });
    await recordEmployment(db, { tenantId, contactId: existing.id, accountId, title: input.title ?? null });

    return { contactId: existing.id, created: false, matchedBy: attempt.by };
  }

  const created = await db.contact.create({
    data: {
      fullName,
      fullNameNormalized,
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
      normalizedCompany,
      accountId,
      title: input.title ?? null,
      department: input.department ?? null,
      seniority: input.seniority ?? null,
      country: input.country ?? null,
      email: input.email,
      phone: input.phone ?? null,
      secondaryPhone: input.secondaryPhone ?? null,
      linkedIn: input.linkedIn ?? null,
      whatsApp: input.whatsApp ?? null,
      emailValidation: input.emailValidation ?? null,
      emailScore: input.emailScore ?? null,
      alternateEmail: input.alternateEmail ?? null,
      alternateEmailValidation: input.alternateEmailValidation ?? null,
      normalizedEmail,
      normalizedPhone,
      normalizedLinkedIn,
      tenantId,
    },
    select: { id: true },
  });

  await recordEmployment(db, { tenantId, contactId: created.id, accountId, title: input.title ?? null });

  return { contactId: created.id, created: true, matchedBy: null };
}

/**
 * One row per person per employer, so re-importing the same roster does not stack duplicates. The
 * history is what keeps a prospect reachable after a job change instead of being overwritten by it.
 */
async function recordEmployment(
  db: ContactIdentityDb,
  input: { tenantId: string; contactId: string; accountId: string; title: string | null }
): Promise<void> {
  await db.contactEmployment.upsert({
    where: {
      tenantId_contactId_accountId: {
        tenantId: input.tenantId,
        contactId: input.contactId,
        accountId: input.accountId,
      },
    },
    create: {
      tenantId: input.tenantId,
      contactId: input.contactId,
      accountId: input.accountId,
      title: input.title,
      isCurrent: true,
    },
    update: {
      isCurrent: true,
      ...(input.title ? { title: input.title } : {}),
    },
  });
}
