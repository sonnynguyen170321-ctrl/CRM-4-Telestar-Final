"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useCompanyDrawer } from "./CompanyDrawerProvider";

// Row entry point for the companies list. Opens the drawer INSTANTLY via the client provider
// (no page navigation); keeps a real href so middle-click / cmd-click / deep-link still work.
export function CompanyRowLink({
  companyId,
  name,
  domain,
  href,
  className,
  children,
}: {
  companyId: string;
  name: string | null;
  domain: string | null;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const { open } = useCompanyDrawer();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        open({ companyId, name, domain });
      }}
    >
      {children}
    </Link>
  );
}
