import { cn } from "@/lib/utils";

type LoadingSkeletonProps = {
  className?: string;
  rows?: number;
};

export function LoadingSkeleton({
  className,
  rows = 3,
}: LoadingSkeletonProps) {
  return (
    <div className={cn("space-y-3", className)} aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-md bg-muted"
        />
      ))}
    </div>
  );
}
