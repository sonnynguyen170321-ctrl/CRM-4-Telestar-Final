import { Globe, Search } from "lucide-react";

import { cn } from "@/lib/utils";

// Shared external-link cluster for drawers: a Website button (opens the company site) and a
// Google button (searches "name title company" so you reach a LinkedIn profile via Google
// instead of hitting linkedin.com directly — avoids LinkedIn-ban risk from heavy direct traffic).
// LinkedIn buttons stay wherever each drawer already renders them.
export function DrawerExternalLinks({
  website,
  google,
  className,
}: {
  website?: string | null;
  google?: string | null;
  className?: string;
}) {
  if (!website && !google) return null;
  const base =
    "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {website ? (
        <a href={website} target="_blank" rel="noreferrer" className={base}>
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          Website
        </a>
      ) : null}
      {google ? (
        <a href={google} target="_blank" rel="noreferrer" className={base} title="Search on Google (reach LinkedIn via results)">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          Google
        </a>
      ) : null}
    </div>
  );
}
