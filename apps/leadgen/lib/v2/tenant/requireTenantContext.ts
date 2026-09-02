import "server-only";

import { prisma } from "@/lib/server/prisma";
import { getCurrentAuthIdentity, V2AuthError } from "@/lib/v2/auth";

import { assertPermission } from "./permissions";
import {
  V2TenantError,
  type V2TenantContext,
  type V2TenantPermission,
} from "./types";

export async function requireTenantContext(): Promise<V2TenantContext> {
  try {
    const identity = await getCurrentAuthIdentity();
    const user = await prisma.v2User.findUnique({
      where: { emailNormalized: identity.emailNormalized },
      select: {
        id: true,
        emailNormalized: true,
        name: true,
        status: true,
        memberships: {
          where: {
            status: "ACTIVE",
            organization: {
              status: "ACTIVE",
            },
          },
          select: {
            id: true,
            organizationId: true,
            role: true,
            organization: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!user) {
      throw new V2TenantError(
        "APP_USER_NOT_FOUND",
        "Authenticated identity is not provisioned in V2."
      );
    }

    if (user.status !== "ACTIVE") {
      throw new V2TenantError(
        "APP_USER_INACTIVE",
        "V2 user is not active."
      );
    }

    const activeMemberships = user.memberships.filter(
      (membership) => membership.organization.status === "ACTIVE"
    );

    if (activeMemberships.length === 0) {
      throw new V2TenantError(
        "NO_ACTIVE_MEMBERSHIP",
        "V2 user does not have an active organization membership."
      );
    }

    if (activeMemberships.length > 1) {
      throw new V2TenantError(
        "MULTIPLE_MEMBERSHIPS_REQUIRE_SELECTOR",
        "Multiple active memberships require an organization selector."
      );
    }

    const membership = activeMemberships[0];

    if (membership.organization.status !== "ACTIVE") {
      throw new V2TenantError(
        "ORG_INACTIVE",
        "Selected organization is not active."
      );
    }

    return {
      userId: user.id,
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
      emailNormalized: user.emailNormalized,
      userName: user.name,
      organizationName: membership.organization.name,
    };
  } catch (error) {
    if (error instanceof V2TenantError) {
      throw error;
    }

    if (error instanceof V2AuthError) {
      throw mapAuthError(error);
    }

    throw error;
  }
}

export async function requirePermission(
  permission: V2TenantPermission
): Promise<V2TenantContext> {
  const context = await requireTenantContext();
  assertPermission(context, permission);

  return context;
}

function mapAuthError(error: V2AuthError) {
  if (error.code === "UNAUTHENTICATED") {
    return new V2TenantError("UNAUTHENTICATED", error.message);
  }


  return new V2TenantError("UNAUTHENTICATED", error.message);
}
