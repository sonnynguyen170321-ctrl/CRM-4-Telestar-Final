"use client";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/shared/ErrorBanner";

export default function CompaniesError({ reset }: { reset: () => void }) {
  return (
    <div className="space-y-4">
      <ErrorBanner
        title="Company results could not load"
        message="Check that the local database is running and the latest Prisma migration has been applied."
      />
      <Button type="button" variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
