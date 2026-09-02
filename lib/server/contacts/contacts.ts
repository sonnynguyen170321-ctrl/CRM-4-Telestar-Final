import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";

export type ContactListInput = {
  search?: string;
  sdrName?: string;
  companyRecordId?: string;
  hasCompanyMatch?: boolean;
  hasManagerReview?: boolean;
  skip: number;
  page: number;
  pageSize: number;
};

const contactInclude = {
  companyRecord: {
    select: {
      id: true,
      companyName: true,
      website: true,
      companyCountry: true,
      companyIndustry: true,
      companyStaffCountRange: true,
      type: true,
    },
  },
  activityRows: {
    where: {
      OR: [
        { meetingDate: { not: null } },
        { meetingStatus: { contains: "book", mode: "insensitive" as const } },
        { meetingStatus: { contains: "meet", mode: "insensitive" as const } },
        { meetingStatus: { contains: "agree", mode: "insensitive" as const } },
      ],
    },
    take: 1,
    select: {
      id: true,
    },
  },
} satisfies Prisma.ContactRecordInclude;

type ContactWithCompany = Prisma.ContactRecordGetPayload<{
  include: typeof contactInclude;
}>;

const contactDetailInclude = {
  ...contactInclude,
  activityRows: {
    orderBy: [{ activityDate: "desc" as const }, { createdAt: "desc" as const }],
    take: 100,
    include: {
      activityUpload: {
        select: {
          id: true,
          fileName: true,
          createdAt: true,
        },
      },
    },
  },
  managerReviewItems: {
    orderBy: [{ createdAt: "desc" as const }],
    take: 10,
    select: {
      id: true,
      priority: true,
      status: true,
      reasonsJson: true,
      nextAction: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ContactRecordInclude;

type ContactDetail = Prisma.ContactRecordGetPayload<{
  include: typeof contactDetailInclude;
}>;

export async function listContacts(input: ContactListInput) {
  const where = buildContactWhere(input);
  const [contacts, total, aggregateCounts] = await Promise.all([
    prisma.contactRecord.findMany({
      where,
      include: contactInclude,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: input.skip,
      take: input.pageSize,
    }),
    prisma.contactRecord.count({ where }),
    getContactCounts(where),
  ]);

  return {
    data: contacts.map(mapContactListItem),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
    },
    counts: aggregateCounts,
  };
}

export async function getContact(id: string) {
  const contact = await prisma.contactRecord.findUnique({
    where: { id },
    include: contactDetailInclude,
  });

  return contact ? mapContactDetail(contact) : null;
}

function buildContactWhere(input: ContactListInput): Prisma.ContactRecordWhereInput {
  const andFilters: Prisma.ContactRecordWhereInput[] = [];

  if (input.search) {
    andFilters.push({
      OR: [
        { fullName: { contains: input.search, mode: "insensitive" } },
        { title: { contains: input.search, mode: "insensitive" } },
        { email: { contains: input.search, mode: "insensitive" } },
        { companyNameRaw: { contains: input.search, mode: "insensitive" } },
        {
          companyRecord: {
            companyName: { contains: input.search, mode: "insensitive" },
          },
        },
      ],
    });
  }

  if (input.sdrName) {
    andFilters.push({
      OR: [{ ownerSdrName: input.sdrName }, { latestSdrName: input.sdrName }],
    });
  }

  if (input.companyRecordId) {
    andFilters.push({ companyRecordId: input.companyRecordId });
  }

  if (input.hasCompanyMatch !== undefined) {
    andFilters.push({
      companyRecordId: input.hasCompanyMatch ? { not: null } : null,
    });
  }

  if (input.hasManagerReview !== undefined) {
    andFilters.push({
      managerReviewCount: input.hasManagerReview ? { gt: 0 } : 0,
    });
  }

  return andFilters.length > 0 ? { AND: andFilters } : {};
}

async function getContactCounts(where: Prisma.ContactRecordWhereInput) {
  const [
    totalContacts,
    withCompanyMatch,
    withActivity,
    withManagerReview,
    withEmail,
    withPhone,
    withLinkedIn,
    meetingBooked,
  ] = await Promise.all([
    prisma.contactRecord.count({ where }),
    prisma.contactRecord.count({
      where: {
        AND: [where, { companyRecordId: { not: null } }],
      },
    }),
    prisma.contactRecord.count({
      where: {
        AND: [where, { activityCount: { gt: 0 } }],
      },
    }),
    prisma.contactRecord.count({
      where: {
        AND: [where, { managerReviewCount: { gt: 0 } }],
      },
    }),
    prisma.contactRecord.count({
      where: {
        AND: [where, { email: { not: null } }],
      },
    }),
    prisma.contactRecord.count({
      where: {
        AND: [where, { phone: { not: null } }],
      },
    }),
    prisma.contactRecord.count({
      where: {
        AND: [where, { contactLinkedInUrl: { not: null } }],
      },
    }),
    prisma.contactRecord.count({
      where: {
        AND: [
          where,
          {
            activityRows: {
              some: {
                OR: [
                  { meetingDate: { not: null } },
                  { meetingStatus: { contains: "book", mode: "insensitive" } },
                  { meetingStatus: { contains: "meet", mode: "insensitive" } },
                  { meetingStatus: { contains: "agree", mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      },
    }),
  ]);

  return {
    totalContacts,
    withCompanyMatch,
    missingCompanyMatch: totalContacts - withCompanyMatch,
    withActivity,
    withManagerReview,
    withEmail,
    withPhone,
    withLinkedIn,
    meetingBooked,
  };
}

function mapContactListItem(contact: ContactWithCompany) {
  return {
    id: contact.id,
    fullName: contact.fullName,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
    contactLinkedInUrl: contact.contactLinkedInUrl,
    companyNameRaw: contact.companyNameRaw,
    companyRecordId: contact.companyRecordId,
    matchedCompanyName: contact.companyRecord?.companyName ?? null,
    matchedCompanyWebsite: contact.companyRecord?.website ?? null,
    matchedCompanyCountry: contact.companyRecord?.companyCountry ?? null,
    matchedCompanyIndustry: contact.companyRecord?.companyIndustry ?? null,
    matchedCompanyStaffCountRange:
      contact.companyRecord?.companyStaffCountRange ?? null,
    matchedCompanyType: contact.companyRecord?.type ?? null,
    ownerSdrName: contact.ownerSdrName,
    latestSdrName: contact.latestSdrName,
    source: contact.source,
    sourceUploadId: contact.sourceUploadId,
    hasMeetingBooked: hasMeetingBooked(contact),
    activityCount: contact.activityCount,
    linkedinCount: contact.linkedinCount,
    emailCount: contact.emailCount,
    callCount: contact.callCount,
    noPickupCount: contact.noPickupCount,
    notInterestedCount: contact.notInterestedCount,
    managerReviewCount: contact.managerReviewCount,
    firstActivityDate: contact.firstActivityDate,
    latestActivityDate: contact.latestActivityDate,
    latestActivitySummary: contact.latestActivitySummary,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

function mapContactDetail(contact: ContactDetail) {
  return {
    ...mapContactListItem(contact),
    normalizedEmail: contact.normalizedEmail,
    normalizedPhone: contact.normalizedPhone,
    normalizedLinkedInUrl: contact.normalizedLinkedInUrl,
    normalizedCompanyName: contact.normalizedCompanyName,
    companyRecord: contact.companyRecord,
    activityRows: contact.activityRows.map((row) => ({
      id: row.id,
      activityUploadId: row.activityUploadId,
      activityUploadFileName: row.activityUpload.fileName,
      activityUploadCreatedAt: row.activityUpload.createdAt,
      rowIndex: row.rowIndex,
      sdrName: row.sdrName,
      leadName: row.leadName,
      companyName: row.companyName,
      title: row.title,
      email: row.email,
      phone: row.phone,
      contactLinkedInUrl: row.contactLinkedInUrl,
      contactCountry: row.contactCountry,
      activityDate: row.activityDate,
      weekLabel: row.weekLabel,
      linkedinStageNormalized: row.linkedinStageNormalized,
      emailStageNormalized: row.emailStageNormalized,
      callStageNormalized: row.callStageNormalized,
      otherChannelNormalized: row.otherChannelNormalized,
      meetingDate: row.meetingDate,
      meetingStatus: row.meetingStatus,
      channelResponded: row.channelResponded,
      noteCombined: row.noteCombined,
      managerReviewFlag: row.managerReviewFlag,
      managerReviewPriority: row.managerReviewPriority,
      managerReviewReasonsJson: row.managerReviewReasonsJson,
      totalActivityCount: row.totalActivityCount,
      createdAt: row.createdAt,
    })),
    managerReviewItems: contact.managerReviewItems.map((item) => ({
      id: item.id,
      priority: item.priority,
      status: item.status,
      reasonsJson: item.reasonsJson,
      nextAction: item.nextAction,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
}

function hasMeetingBooked(contact: ContactWithCompany | ContactDetail) {
  return contact.activityRows.some((row) => {
    if (!("meetingStatus" in row)) {
      return true;
    }

    const detailRow = row as {
      meetingDate?: string | null;
      meetingStatus?: string | null;
    };
    const status = detailRow.meetingStatus?.toLowerCase() ?? "";
    return (
      Boolean(detailRow.meetingDate) ||
      status.includes("book") ||
      status.includes("meet") ||
      status.includes("agree")
    );
  });
}

