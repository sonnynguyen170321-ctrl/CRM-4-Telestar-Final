"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/v2/tenant";
import {
  canPersistContactDecision,
  contactIdentifierValidity,
  findContactDetails,
  type ContactChannelDecision,
  type EmailStatus,
} from "@/lib/v2/research/enrichContact";
import { upsertContactIdentifier, type IdentifierDb } from "@/lib/v2/crm/upsertContactIdentifier";

// Find + verify a contact's email/phone from their company site (same clean-room waterfall the
// research engine uses: site-harvest -> pattern -> MX/SPF/DMARC/Reacher/SMTP), then persist as
// reviewed contact evidence. Only auto-usable decisions become V2ContactIdentifier rows.

export type EnrichContactResult =
  | { ok: true; email: string | null; emailStatus: EmailStatus | null; phone: string | null; emailDecision?: ContactChannelDecision | null; phoneDecision?: ContactChannelDecision | null }
  | { ok: false; error: string };

export async function enrichContactChannelsAction(contactId: string): Promise<EnrichContactResult> {
  const ctx = await requirePermission("ingestion.apply");

  const contact = await prisma.v2Contact.findFirst({
    where: { id: contactId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, fullName: true },
  });
  if (!contact) return { ok: false, error: "Contact not found." };

  // Company domain from the contact's current employer.
  const employment = await prisma.v2ContactEmployment.findFirst({
    where: { organizationId: ctx.organizationId, contactId: contact.id, isCurrent: true },
    orderBy: { startDate: "desc" },
    select: { companyId: true },
  });
  const company = employment
    ? await prisma.v2Company.findFirst({
        where: { id: employment.companyId, organizationId: ctx.organizationId, deletedAt: null },
        select: { canonicalDomain: true },
      })
    : null;
  const domain = company?.canonicalDomain ?? null;
  if (!domain) return { ok: false, error: "No company domain on file — add the contact's company first." };

  const details = await findContactDetails({ fullName: contact.fullName, companyDomain: domain, organizationId: ctx.organizationId });
  const idb = prisma as unknown as IdentifierDb;

  if (details.emailDecision && canPersistContactDecision(details.emailDecision)) {
    await upsertContactIdentifier(idb, {
      organizationId: ctx.organizationId, contactId: contact.id, type: "EMAIL",
      rawValue: details.emailDecision.value,
      validityStatus: contactIdentifierValidity(details.emailDecision),
      source: "MANUAL_ENRICH",
    });
  }
  if (details.phoneDecision && canPersistContactDecision(details.phoneDecision)) {
    await upsertContactIdentifier(idb, {
      organizationId: ctx.organizationId, contactId: contact.id, type: "PHONE",
      rawValue: details.phoneDecision.value,
      validityStatus: contactIdentifierValidity(details.phoneDecision),
      source: "MANUAL_ENRICH",
    });
  }

  revalidatePath("/v2/crm/contacts");
  return { ok: true, email: details.email, emailStatus: details.emailStatus, phone: details.phone, emailDecision: details.emailDecision, phoneDecision: details.phoneDecision };
}
