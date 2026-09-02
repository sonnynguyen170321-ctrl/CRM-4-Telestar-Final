"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  
  const tabs = [
    { name: "Overview", href: `/v2/workspace/projects/${projectId}` },
    { name: "Products", href: `/v2/workspace/projects/${projectId}/products` },
    { name: "ICPs", href: `/v2/workspace/projects/${projectId}/icps` },
    { name: "Leads", href: `/v2/workspace/projects/${projectId}/leads` },
    { name: "Activity", href: `/v2/workspace/projects/${projectId}/activity` },
    { name: "Reports", href: `/v2/workspace/projects/${projectId}/reports` },
  ];

  return (
    <div className="bg-white border-b px-6">
      <div className="max-w-7xl mx-auto flex items-center h-12 gap-6">
        {tabs.map(tab => {
          const isActive = tab.name === "Overview" 
            ? pathname === tab.href
            : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center justify-center whitespace-nowrap px-1 h-full text-sm font-medium transition-all ${
                isActive 
                  ? "border-b-2 border-primary text-primary" 
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
