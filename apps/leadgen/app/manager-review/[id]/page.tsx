import Link from "next/link";

import { ManagerReviewDetail } from "@/components/manager-review/ManagerReviewDetail";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";

type ManagerReviewDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ManagerReviewDetailPage({
  params,
}: ManagerReviewDetailPageProps) {
  const { id } = await params;

  return (
    <main className="min-h-screen bg-slate-50">
      <PageHeader
        eyebrow="Manager review"
        title="Review item"
        description="Manager review is an operations workflow. It does not change scoring or SDR final feedback."
        actions={
          <Button asChild variant="outline">
            <Link href="/manager-review">Back to queue</Link>
          </Button>
        }
      />
      <ManagerReviewDetail id={id} />
    </main>
  );
}
