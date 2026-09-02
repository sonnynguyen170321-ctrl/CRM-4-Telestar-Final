"use server";

import { redirect } from "next/navigation";

import { authenticatePassword } from "@/lib/v2/auth/login";
import { createAuthSession } from "@/lib/v2/auth/session";

export type LoginFormState = {
  error?: string;
};

export async function loginAction(_prevState: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const returnTo = sanitizeReturnTo(String(formData.get("returnTo") ?? ""));

  const result = await authenticatePassword({ email, password });
  if (!result.ok) {
    if (result.code === "LOCKED") {
      return { error: "Too many failed attempts. Try again in about 15 minutes." };
    }
    if (result.code === "AUTH_NOT_CONFIGURED") {
      return { error: "V2_AUTH_SECRET is not configured on this server." };
    }
    return { error: "Email or password is incorrect." };
  }

  await createAuthSession({ userId: result.userId });
  redirect(returnTo);
}

function sanitizeReturnTo(value: string): string {
  if (!value || !value.startsWith("/v2/") || value.startsWith("/v2/login") || value.startsWith("/v2/logout")) {
    return "/v2/workspace/leads";
  }
  return value;
}