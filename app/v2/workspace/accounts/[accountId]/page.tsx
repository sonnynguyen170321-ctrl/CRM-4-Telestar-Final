import { redirect } from "next/navigation";

export default async function AccountDetailCompatibilityPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  redirect(`/v2/workspace/accounts?accountId=${accountId}&drawer=account`);
}
