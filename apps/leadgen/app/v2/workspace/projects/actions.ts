"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/v2/tenant/requireTenantContext";
import { createProject } from "@/lib/v2/product-tree/createProductTree";

export async function createProjectAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");

  const clientAccountId = formData.get("clientAccountId")?.toString().trim();
  const name = formData.get("name")?.toString().trim();
  const description = formData.get("description")?.toString().trim();

  if (!clientAccountId) return { error: "Account ID is required." };
  if (!name) return { error: "Name is required." };

  try {
    const project = await createProject({
      organizationId: context.organizationId,
      clientAccountId,
      name,
      description,
    });

    revalidatePath("/v2/workspace/accounts");
    return { success: true, project };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create project" };
  }
}
