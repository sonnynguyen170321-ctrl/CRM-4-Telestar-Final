import { AlertTriangle } from "lucide-react";

type ErrorBannerProps = {
  title: string;
  message: string;
};

export function ErrorBanner({ title, message }: ErrorBannerProps) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
      <div className="flex gap-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div>
          <h2 className="font-medium text-foreground">{title}</h2>
          <p className="mt-1 leading-6 text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}
