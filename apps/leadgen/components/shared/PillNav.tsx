"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type PillNavItem = {
  label: string;
  href: string;
  icon?: LucideIcon;
};

type PillNavProps = {
  items: readonly PillNavItem[];
  className?: string;
};

export function PillNav({ items, className }: PillNavProps) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex items-center gap-1.5 p-1 bg-muted/50 rounded-xl border border-border/60 w-fit", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        // Exact match or active sub-route, except if it's the exact base path
        const isActive = pathname === item.href || (pathname.startsWith(`${item.href}/`) && item.href !== "/");

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-300",
              isActive
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
            )}
          >
            {Icon && <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
