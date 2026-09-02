import "server-only";

import { prisma } from "@/lib/server/prisma";
import { parseLeadIdsParam } from "@/lib/v2/crm/leadRoutes";
import { decideSuppression, type SuppressionCandidateRow } from "../suppression/decideSuppression";
import { normalizeEmailIdentifier } from "../suppression/normalizeIdentifier";

export type CampaignWizardLead = {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  projectName: string;
  qualification: "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED" | "NOT_SCORED";
  fitScore: number | null;
  timezone: string | null;
  suppressed: boolean;
  alreadyEnrolled: boolean;
  selectable: boolean;
  issue: string | null;
};

// W3: the campaign lead source. Instead of a global top-200, the picker can be scoped
// to the leads the SDR actually selected/filtered in /v2/leads (audit bottleneck #5).
export type CampaignLeadSource =
  | { kind: "selected"; leadAssignmentIds: string[] }
  | { kind: "filter"; projectId?: string; icpVersionId?: string; clientAccountId?: string; ownerUserId?: string }
  | { kind: "recent" };

const MAX_SELECTION = 1000;
const RECENT_LIMIT = 200;

/** Parse the campaign lead source from a page's searchParams (?source=selected&leadIds=… / ?source=filter&…). */
export function parseCampaignSource(
  sp: Record<string, string | string[] | undefined>
): CampaignLeadSource {
  const get = (key: string) => {
    const value = sp[key];
    const first = Array.isArray(value) ? value[0] : value;
    return first && first.trim() ? first.trim() : undefined;
  };
  const kind = get("source");
  if (kind === "selected") {
    return { kind: "selected", leadAssignmentIds: parseLeadIdsParam(get("leadIds")) };
  }
  if (kind === "filter") {
    return {
      kind: "filter",
      projectId: get("projectId"),
      icpVersionId: get("icpVersionId"),
      clientAccountId: get("clientAccountId"),
      ownerUserId: get("ownerUserId"),
    };
  }
  return { kind: "recent" };
}

export async function queryCampaignWizardLeads(
  organizationId: string,
  campaignId: string,
  source: CampaignLeadSource = { kind: "recent" }
): Promise<CampaignWizardLead[]> {
  const where: Record<string, unknown> = {
    organizationId,
    status: "ACTIVE",
    deletedAt: null,
    company: { status: "ACTIVE", deletedAt: null },
    project: { status: "ACTIVE" },
    icpVersion: { deletedAt: null },
  };

  if (source.kind === "selected") {
    const ids = Array.from(new Set(source.leadAssignmentIds.filter(Boolean))).slice(0, MAX_SELECTION);
    where.id = { in: ids.length > 0 ? ids : ["__none__"] };
  } else if (source.kind === "filter") {
    if (source.projectId) where.projectId = source.projectId;
    if (source.icpVersionId) where.icpVersionId = source.icpVersionId;
    if (source.ownerUserId) where.ownerUserId = source.ownerUserId;
    if (source.clientAccountId) where.project = { status: "ACTIVE", clientAccountId: source.clientAccountId };
  }

  const assignments = await prisma.v2LeadAssignment.findMany({
    where,
    include: {
      company: { select: { name: true, canonicalDomain: true } },
      contact: {
        include: {
          identifiers: {
            where: { type: "EMAIL", isValid: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      project: { select: { name: true } },
      latestHardRuleAssessment: {
        select: { qualification: true, fitScore: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: source.kind === "recent" ? RECENT_LIMIT : MAX_SELECTION,
  });
  const leadIds = assignments.map((assignment) => assignment.id);
  const [profiles, enrollments, suppressions] = await Promise.all([
    prisma.v2LeadOutreachProfile.findMany({
      where: { organizationId, leadAssignmentId: { in: leadIds }, deletedAt: null },
      select: {
        leadAssignmentId: true,
        primaryEmailNormalized: true,
        timezone: true,
      },
    }),
    prisma.v2SequenceEnrollment.findMany({
      where: {
        organizationId,
        sequenceId: campaignId,
        leadAssignmentId: { in: leadIds },
        deletedAt: null,
      },
      select: { leadAssignmentId: true },
    }),
    prisma.v2SuppressionEntry.findMany({
      where: {
        organizationId,
        deletedAt: null,
        identifierType: { in: ["EMAIL", "DOMAIN"] },
      },
      select: {
        id: true,
        identifierType: true,
        identifierValueNormalized: true,
        suppressionType: true,
        scopeType: true,
        deletedAt: true,
        expiresAt: true,
      },
    }),
  ]);
  const profileByLead = new Map(profiles.map((profile) => [profile.leadAssignmentId, profile]));
  const enrolled = new Set(enrollments.map((item) => item.leadAssignmentId));
  const candidates = suppressions as unknown as SuppressionCandidateRow[];

  return assignments
    .map((assignment): CampaignWizardLead => {
      const profile = profileByLead.get(assignment.id);
      const contactIsActive =
        assignment.contact?.status === "ACTIVE" && assignment.contact.deletedAt === null;
      const identifierEmail = contactIsActive
        ? assignment.contact?.identifiers[0]?.normalizedValue ?? null
        : null;
      const email = normalizeEmailIdentifier(
        profile?.primaryEmailNormalized ?? identifierEmail
      );
      const suppressed = Boolean(decideSuppression(candidates, { email }));
      const alreadyEnrolled = enrolled.has(assignment.id);
      const qualification = normalizeQualification(
        assignment.latestHardRuleAssessment?.qualification
      );
      const issue = alreadyEnrolled
        ? "Already enrolled"
        : !contactIsActive
          ? "No active contact"
          : !email
            ? "No valid email"
            : suppressed
              ? "Suppressed"
              : qualification !== "QUALIFIED"
                ? "Override reason required"
                : null;
      return {
        id: assignment.id,
        companyName: assignment.company.name,
        contactName: contactIsActive ? assignment.contact?.fullName ?? null : null,
        email,
        projectName: assignment.project.name,
        qualification,
        fitScore: assignment.latestHardRuleAssessment?.fitScore ?? null,
        timezone: profile?.timezone ?? null,
        suppressed,
        alreadyEnrolled,
        selectable: Boolean(email) && !suppressed && !alreadyEnrolled,
        issue,
      };
    })
    .sort(compareLeads);
}

function normalizeQualification(
  value: string | null | undefined
): CampaignWizardLead["qualification"] {
  if (value === "QUALIFIED" || value === "NEEDS_REVIEW" || value === "UNQUALIFIED") {
    return value;
  }
  return value ? "NEEDS_REVIEW" : "NOT_SCORED";
}

function compareLeads(left: CampaignWizardLead, right: CampaignWizardLead) {
  const rank = { QUALIFIED: 0, NEEDS_REVIEW: 1, UNQUALIFIED: 2, NOT_SCORED: 3 };
  const qualification = rank[left.qualification] - rank[right.qualification];
  if (qualification !== 0) return qualification;
  const score = (right.fitScore ?? -1) - (left.fitScore ?? -1);
  if (score !== 0) return score;
  return left.companyName.localeCompare(right.companyName);
}