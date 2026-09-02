import { shapeContactEnrichment } from "./contactEnrichment";
import { resolveContactDisplayName } from "./resolveContactDisplayName";

export type ContactRow = {
  id: string;
  fullName: string;
  title: string | null;
  status: string;
  email?: string | null;
  companyName?: string | null;
  leadAssignmentCount?: number;
  phone?: string | null;
  linkedInUrl?: string | null;
  city?: string | null;
  country?: string | null;
  source?: string | null;
  confidenceBand?: string | null;
  activityStatus?: string | null;
  meetingStatus?: string | null;
  managerReviewStatus?: string | null;
  qualification?: string | null;
  primaryLeadAssignmentId?: string | null;
  ownerName?: string | null;
  activeEnrollmentCount?: number;
};

export type ShapedContact = {
  id: string;
  fullName: string;
  title: string | null;
  status: string;
  email: string | null;
  emailPresent: boolean;
  companyName: string | null;
  seniorityTier: string;
  department: string;
  leadAssignmentCount: number;
  phone: string | null;
  linkedInUrl: string | null;
  city: string | null;
  country: string | null;
  source: string | null;
  confidenceBand: string | null;
  activityStatus: string | null;
  meetingStatus: string | null;
  managerReviewStatus: string | null;
  qualification: string | null;
  primaryLeadAssignmentId: string | null;
  ownerName: string | null;
  activeEnrollmentCount: number;
};

export function shapeContact(row: ContactRow): ShapedContact {
  const contact = shapeContactEnrichment(row);

  return {
    id: row.id,
    fullName: resolveContactDisplayName({
      fullName: contact.fullName,
      email: contact.email,
      companyName: row.companyName ?? null,
    }),
    title: contact.title,
    status: row.status,
    email: contact.email,
    emailPresent: contact.hasUsableEmail,
    companyName: row.companyName ?? null,
    seniorityTier: contact.seniorityTier,
    department: contact.department,
    leadAssignmentCount: row.leadAssignmentCount ?? 0,
    phone: contact.phone,
    linkedInUrl: contact.linkedInUrl,
    city: contact.city,
    country: contact.country,
    source: contact.source,
    confidenceBand: row.confidenceBand ? mapConfidence(row.confidenceBand) : null,
    activityStatus: row.activityStatus ?? null,
    meetingStatus: row.meetingStatus ?? null,
    managerReviewStatus: row.managerReviewStatus ?? null,
    qualification: row.qualification ?? null,
    primaryLeadAssignmentId: row.primaryLeadAssignmentId ?? null,
    ownerName: row.ownerName ?? null,
    activeEnrollmentCount: row.activeEnrollmentCount ?? 0,
  };
}

function mapConfidence(value: string): string {
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) return "Low";
  if (numeric >= 0.85) return "High";
  if (numeric >= 0.6) return "Medium";
  return "Low";
}

export type ContactsPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ContactsWorkspace = {
  contacts: ShapedContact[];
  facets: {
    total: number;
    withEmail: number;
    qualified: number;
    uncertain: number;
    unqualified: number;
    noContact: number;
    meetingBooked: number;
    bySeniority: Record<string, number>;
  };
  pagination?: ContactsPagination;
};

export function shapeContactsWorkspace(rows: readonly ContactRow[]): ContactsWorkspace {
  const contacts = rows.map(shapeContact);
  const bySeniority: Record<string, number> = {};
  let withEmail = 0;
  let qualified = 0;
  let uncertain = 0;
  let unqualified = 0;
  let noContact = 0;
  let meetingBooked = 0;

  for (const contact of contacts) {
    bySeniority[contact.seniorityTier] = (bySeniority[contact.seniorityTier] ?? 0) + 1;
    if (contact.emailPresent) withEmail += 1;
    if (contact.qualification === "QUALIFIED") qualified += 1;
    if (contact.qualification === "NEEDS_REVIEW") uncertain += 1;
    if (contact.qualification === "UNQUALIFIED") unqualified += 1;
    if (!contact.emailPresent && !contact.phone) noContact += 1;
    if (contact.meetingStatus?.toLowerCase().includes("meeting")) meetingBooked += 1;
  }

  return {
    contacts,
    facets: {
      total: contacts.length,
      withEmail,
      qualified,
      uncertain,
      unqualified,
      noContact,
      meetingBooked,
      bySeniority,
    },
  };
}
