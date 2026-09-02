import { prisma } from "@/lib/server/prisma";
import {
  Prisma,
  V2ClientAccount,
  V2Project,
  V2Offer,
  V2ICPProfile,
  V2ICPVersion,
} from "@/app/generated/prisma/client";
import { emptyIcpRulesV2 } from "../scoring/rules/emptyIcpRulesV2";
import { getIcpTemplateV2 } from "../scoring/rules/icpTemplatesV2";

export async function createClientAccount({
  organizationId,
  name,
  description,
}: {
  organizationId: string;
  name: string;
  description?: string;
}): Promise<V2ClientAccount> {
  const existing = await prisma.v2ClientAccount.findUnique({
    where: {
      organizationId_name: {
        organizationId,
        name,
      },
    },
  });

  if (existing) {
    throw new Error(`Account with name "${name}" already exists.`);
  }

  return prisma.v2ClientAccount.create({
    data: {
      organizationId,
      name,
      description,
      status: "ACTIVE",
    },
  });
}

export async function createProject({
  organizationId,
  clientAccountId,
  name,
  description,
}: {
  organizationId: string;
  clientAccountId: string;
  name: string;
  description?: string;
}): Promise<V2Project> {
  const account = await prisma.v2ClientAccount.findUnique({
    where: { id: clientAccountId, organizationId },
  });

  if (!account) {
    throw new Error(`Account not found or belongs to another organization.`);
  }

  const existing = await prisma.v2Project.findUnique({
    where: {
      organizationId_clientAccountId_name: {
        organizationId,
        clientAccountId,
        name,
      },
    },
  });

  if (existing) {
    throw new Error(`Project with name "${name}" already exists for this account.`);
  }

  return prisma.v2Project.create({
    data: {
      organizationId,
      clientAccountId,
      name,
      description,
      status: "ACTIVE",
    },
  });
}

export async function createOffer({
  organizationId,
  projectId,
  name,
  description,
}: {
  organizationId: string;
  projectId: string;
  name: string;
  description?: string;
}): Promise<V2Offer> {
  const project = await prisma.v2Project.findUnique({
    where: { id: projectId, organizationId },
  });

  if (!project) {
    throw new Error(`Project not found or belongs to another organization.`);
  }

  const existing = await prisma.v2Offer.findUnique({
    where: {
      organizationId_projectId_name: {
        organizationId,
        projectId,
        name,
      },
    },
  });

  if (existing) {
    throw new Error(`Offer with name "${name}" already exists for this project.`);
  }

  return prisma.v2Offer.create({
    data: {
      organizationId,
      projectId,
      name,
      description,
      status: "ACTIVE",
    },
  });
}

export async function createEmptyIcpProfile({
  organizationId,
  userId,
  offerId,
  name,
  description,
  templateId,
}: {
  organizationId: string;
  userId: string;
  offerId: string;
  name: string;
  description?: string;
  // Optional prebuilt v2 template ("start from template"). Falls back to an empty rule set.
  templateId?: string;
}): Promise<{ profile: V2ICPProfile; version: V2ICPVersion }> {
  const offer = await prisma.v2Offer.findUnique({
    where: { id: offerId, organizationId },
  });

  if (!offer) {
    throw new Error(`Offer not found or belongs to another organization.`);
  }

  const existingProfile = await prisma.v2ICPProfile.findUnique({
    where: {
      organizationId_offerId_name: {
        organizationId,
        offerId,
        name,
      },
    },
  });

  if (existingProfile) {
    throw new Error(`ICP Profile with name "${name}" already exists for this offer.`);
  }

  const ruleSetId = `icp-${organizationId}-${Date.now()}`;
  const template = templateId ? getIcpTemplateV2(templateId) : null;
  const validatedRules = template ? template.build(ruleSetId) : emptyIcpRulesV2(ruleSetId, name);

  return prisma.$transaction(async (tx) => {
    const profile = await tx.v2ICPProfile.create({
      data: {
        organizationId,
        offerId,
        name,
        description,
        status: "ACTIVE",
      },
    });

    const version = await tx.v2ICPVersion.create({
      data: {
        organizationId,
        icpProfileId: profile.id,
        versionNumber: 1,
        status: "DRAFT",
        rulesJson: validatedRules as unknown as Prisma.InputJsonValue,
      },
    });

    return { profile, version };
  });
}
