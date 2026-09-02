"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/v2/tenant/requireTenantContext";
import { createOffer } from "@/lib/v2/product-tree/createProductTree";

export async function createOfferAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");

  const projectId = formData.get("projectId")?.toString().trim();
  const name = formData.get("name")?.toString().trim();
  const description = formData.get("description")?.toString().trim();

  if (!projectId) return { error: "Project ID is required." };
  if (!name) return { error: "Name is required." };

  try {
    const offer = await createOffer({
      organizationId: context.organizationId,
      projectId,
      name,
      description,
    });

    revalidatePath("/v2/offers");
    revalidatePath("/v2/workspace/accounts");
    revalidatePath(`/v2/workspace/projects/${projectId}`);
    return { success: true, offer };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create offer" };
  }
}
