import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";

export type ContactSyncSummary = {
  uploadId: string;
  totalRows: number;
  contactsCreated: number;
  contactsUpdated: number;
  rowsLinked: number;
  rowsSkipped: number;
};

type ActivityRowForContactSync = Prisma.SdrActivityRowGetPayload<object>;
type ContactForSync = Prisma.ContactRecordGetPayload<object>;

export async function syncContactsForActivityUpload(
  activityUploadId: string
): Promise<ContactSyncSummary> {
  const rows = await prisma.sdrActivityRow.findMany({
    where: { activityUploadId },
    orderBy: [{ rowIndex: "asc" }],
  });

  let contactsCreated = 0;
  let contactsUpdated = 0;
  let rowsLinked = 0;
  let rowsSkipped = 0;

  for (const row of rows) {
    const identity = getContactIdentity(row);
    if (!identity.hasEnoughIdentity) {
      rowsSkipped += 1;
      continue;
    }

    const existing = await findExistingContact(row, identity);
    const contact = existing
      ? await updateContactFromRow(existing, row, activityUploadId)
      : await createContactFromRow(row, identity, activityUploadId);

    if (existing) {
      contactsUpdated += 1;
    } else {
      contactsCreated += 1;
    }

    await prisma.sdrActivityRow.update({
      where: { id: row.id },
      data: { contactRecordId: contact.id },
    });
    rowsLinked += 1;

    await recomputeContactActivityStats(contact.id);
  }

  return {
    uploadId: activityUploadId,
    totalRows: rows.length,
    contactsCreated,
    contactsUpdated,
    rowsLinked,
    rowsSkipped,
  };
}

async function findExistingContact(
  row: ActivityRowForContactSync,
  identity: ContactIdentity
) {
  if (identity.normalizedLinkedInUrl) {
    const contact = await prisma.contactRecord.findFirst({
      where: { normalizedLinkedInUrl: identity.normalizedLinkedInUrl },
    });
    if (contact) return contact;
  }

  if (identity.normalizedEmail) {
    const contact = await prisma.contactRecord.findFirst({
      where: { normalizedEmail: identity.normalizedEmail },
    });
    if (contact) return contact;
  }

  if (identity.normalizedPhone && identity.normalizedPhone.length >= 7) {
    const contact = await prisma.contactRecord.findFirst({
      where: { normalizedPhone: identity.normalizedPhone },
    });
    if (contact) return contact;
  }

  if (identity.normalizedFullName && row.matchedCompanyRecordId) {
    const contacts = await prisma.contactRecord.findMany({
      where: { companyRecordId: row.matchedCompanyRecordId },
    });
    const exact = contacts.find(
      (contact) => normalizeName(contact.fullName) === identity.normalizedFullName
    );
    if (exact) return exact;
  }

  if (identity.normalizedFullName && identity.normalizedCompanyName) {
    const contacts = await prisma.contactRecord.findMany({
      where: { normalizedCompanyName: identity.normalizedCompanyName },
    });
    const exact = contacts.find(
      (contact) => normalizeName(contact.fullName) === identity.normalizedFullName
    );
    if (exact) return exact;
  }

  return null;
}

async function createContactFromRow(
  row: ActivityRowForContactSync,
  identity: ContactIdentity,
  activityUploadId: string
) {
  const nameParts = splitName(row.leadName || identity.fallbackName);

  return prisma.contactRecord.create({
    data: {
      fullName: row.leadName?.trim() || identity.fallbackName || "Unknown Contact",
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      title: emptyToNull(row.title),
      email: emptyToNull(row.email),
      normalizedEmail: identity.normalizedEmail || null,
      phone: emptyToNull(row.phone),
      normalizedPhone: identity.normalizedPhone || null,
      contactLinkedInUrl: emptyToNull(row.contactLinkedInUrl),
      normalizedLinkedInUrl: identity.normalizedLinkedInUrl || null,
      companyNameRaw: emptyToNull(row.companyName),
      normalizedCompanyName: identity.normalizedCompanyName || null,
      companyRecordId: row.matchedCompanyRecordId,
      ownerSdrName: emptyToNull(row.sdrName),
      latestSdrName: emptyToNull(row.sdrName),
      sourceUploadId: activityUploadId,
      firstActivityDate: getActivityDate(row),
      latestActivityDate: getActivityDate(row),
      latestActivitySummary: summarizeActivityRow(row),
    },
  });
}

async function updateContactFromRow(
  contact: ContactForSync,
  row: ActivityRowForContactSync,
  activityUploadId: string
) {
  const latestDate = getActivityDate(row);

  return prisma.contactRecord.update({
    where: { id: contact.id },
    data: {
      title: contact.title || emptyToNull(row.title),
      email: contact.email || emptyToNull(row.email),
      normalizedEmail: contact.normalizedEmail || normalizeEmail(row.email) || null,
      phone: contact.phone || emptyToNull(row.phone),
      normalizedPhone: contact.normalizedPhone || normalizePhone(row.phone) || null,
      contactLinkedInUrl: contact.contactLinkedInUrl || emptyToNull(row.contactLinkedInUrl),
      normalizedLinkedInUrl:
        contact.normalizedLinkedInUrl || normalizeLinkedInUrl(row.contactLinkedInUrl) || null,
      companyNameRaw: contact.companyNameRaw || emptyToNull(row.companyName),
      normalizedCompanyName:
        contact.normalizedCompanyName || normalizeCompanyName(row.companyName) || null,
      companyRecordId: contact.companyRecordId || row.matchedCompanyRecordId,
      ownerSdrName: contact.ownerSdrName || emptyToNull(row.sdrName),
      latestSdrName: emptyToNull(row.sdrName) || contact.latestSdrName,
      sourceUploadId: contact.sourceUploadId || activityUploadId,
      firstActivityDate: chooseEarlierDate(contact.firstActivityDate, latestDate),
      latestActivityDate: chooseLaterDate(contact.latestActivityDate, latestDate),
      latestActivitySummary: latestDate
        ? summarizeActivityRow(row)
        : contact.latestActivitySummary || summarizeActivityRow(row),
    },
  });
}

async function recomputeContactActivityStats(contactRecordId: string) {
  const rows = await prisma.sdrActivityRow.findMany({
    where: { contactRecordId },
    orderBy: [{ activityDate: "asc" }, { createdAt: "asc" }],
  });
  const latest = rows.at(-1);

  await prisma.contactRecord.update({
    where: { id: contactRecordId },
    data: {
      activityCount: rows.reduce((total, row) => total + row.totalActivityCount, 0),
      linkedinCount: rows.reduce((total, row) => total + row.linkedinCount, 0),
      emailCount: rows.reduce((total, row) => total + row.emailCount, 0),
      callCount: rows.reduce((total, row) => total + row.callCount, 0),
      noPickupCount: rows.reduce((total, row) => total + row.noPickupCount, 0),
      notInterestedCount: rows.reduce((total, row) => total + row.notInterestedCount, 0),
      managerReviewCount: rows.filter((row) => row.managerReviewFlag).length,
      firstActivityDate: rows[0] ? getActivityDate(rows[0]) : null,
      latestActivityDate: latest ? getActivityDate(latest) : null,
      latestActivitySummary: latest ? summarizeActivityRow(latest) : null,
      latestSdrName: latest?.sdrName || null,
    },
  });
}

type ContactIdentity = {
  hasEnoughIdentity: boolean;
  normalizedFullName: string;
  normalizedLinkedInUrl: string;
  normalizedEmail: string;
  normalizedPhone: string;
  normalizedCompanyName: string;
  fallbackName: string;
};

function getContactIdentity(row: ActivityRowForContactSync): ContactIdentity {
  const normalizedFullName = normalizeName(row.leadName);
  const normalizedLinkedInUrl = normalizeLinkedInUrl(row.contactLinkedInUrl);
  const normalizedEmail = normalizeEmail(row.email);
  const normalizedPhone = normalizePhone(row.phone);
  const normalizedCompanyName = normalizeCompanyName(row.companyName);

  return {
    hasEnoughIdentity: Boolean(
      normalizedFullName ||
        normalizedLinkedInUrl ||
        normalizedEmail ||
        normalizedPhone
    ),
    normalizedFullName,
    normalizedLinkedInUrl,
    normalizedEmail,
    normalizedPhone,
    normalizedCompanyName,
    fallbackName: normalizedEmail || normalizedLinkedInUrl || normalizedPhone,
  };
}

function summarizeActivityRow(row: ActivityRowForContactSync) {
  const parts: string[] = [];
  if (row.linkedinCount > 0) parts.push(`LinkedIn ${row.linkedinStageNormalized}`);
  if (row.emailCount > 0) parts.push(`Email ${row.emailStageNormalized}`);
  if (row.callCount > 0) parts.push(`Call ${row.callStageNormalized.replaceAll("_", " ")}`);
  if (row.otherChannelCount > 0) parts.push(`Other ${row.otherChannelNormalized}`);
  return parts.length > 0 ? parts.join(" + ") : "Activity logged";
}

function getActivityDate(row: ActivityRowForContactSync) {
  return row.activityDate || row.weekLabel || row.createdAt.toISOString();
}

function splitName(value: string | null | undefined) {
  const parts = value?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizePhone(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  const leadingPlus = trimmed.startsWith("+") ? "+" : "";
  return `${leadingPlus}${trimmed.replace(/\D/g, "")}`;
}

function normalizeLinkedInUrl(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.split(/[?#]/)[0].replace(/\/+$/, "");
}

function normalizeName(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ") ?? ""
  );
}

function normalizeCompanyName(value: string | null | undefined) {
  return normalizeName(value).replace(
    /\b(pte ltd|co ltd|llc|ltd|inc|corp|corporation|company|group|limited|ab|aps|as)\b/g,
    ""
  ).replace(/\s+/g, " ").trim();
}

function chooseEarlierDate(existing: string | null, next: string | null) {
  if (!existing) return next;
  if (!next) return existing;
  return next.localeCompare(existing) < 0 ? next : existing;
}

function chooseLaterDate(existing: string | null, next: string | null) {
  if (!existing) return next;
  if (!next) return existing;
  return next.localeCompare(existing) > 0 ? next : existing;
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

