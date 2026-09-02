"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/v2/tenant/requireTenantContext";
import { createClientAccount } from "@/lib/v2/product-tree/createProductTree";

export async function createAccountAction(formData: FormData) {
  const context = await requirePermission("product_tree.write");

  const name = formData.get("name")?.toString().trim();
  const description = formData.get("description")?.toString().trim();

  if (!name) {
    return { error: "Name is required." };
  }

  try {
    const account = await createClientAccount({
      organizationId: context.organizationId,
      name,
      description,
    });

    revalidatePath("/v2/workspace/accounts");
    return { success: true, account };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create account" };
  }
}
