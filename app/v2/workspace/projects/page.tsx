import { redirect } from "next/navigation";

export const metadata = {
  title: "Projects - Leadger",
};

export default async function ProjectsCompatibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams();
  next.set("view", "projects");
  const accountId = pick(params, "accountId");
  const search = pick(params, "search");
  if (accountId) next.set("accountId", accountId);
  if (search) next.set("search", search);
  if (pick(params, "create") === "true") next.set("create", "project");
  redirect(`/v2/workspace/accounts?${next.toString()}`);
}

function pick(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}
