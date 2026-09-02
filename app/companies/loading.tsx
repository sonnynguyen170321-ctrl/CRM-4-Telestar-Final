import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";

export default function CompaniesLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-56 rounded-md bg-muted" />
        <div className="mt-3 h-4 w-full max-w-2xl rounded-md bg-muted" />
      </div>
      <LoadingSkeleton rows={8} />
    </div>
  );
}
