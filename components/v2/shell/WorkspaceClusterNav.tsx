"use client";

import { Activity, BarChart3, Building2, ListChecks, Sparkles, UploadCloud, Users } from "lucide-react";

import { PillNav, type PillNavItem } from "@/components/shared/PillNav";

// Cluster navs unify related routes into one perceived workspace (the CampaignNav pattern via the
// shared PillNav). Purely navigational — each destination keeps its own server page + data flow.
// This is the "minimize redundant surfaces" mandate done safely: no route bodies are merged, so no
// tenant/query logic moves. PillNav derives the active tab from usePathname.

const ANALYTICS: PillNavItem[] = [
  { label: "Outreach reports", href: "/v2/reports", icon: BarChart3 },
  { label: "Campaign performance", href: "/v2/outreach/performance", icon: Activity },
];

const IMPORT: PillNavItem[] = [
  { label: "Upload", href: "/v2/ingestion/uploads", icon: UploadCloud },
  { label: "Jobs", href: "/v2/ingestion/jobs", icon: ListChecks },
];

const CRM: PillNavItem[] = [
  { label: "Companies", href: "/v2/crm/companies", icon: Building2 },
  { label: "Contacts", href: "/v2/crm/contacts", icon: Users },
  { label: "Intelligence", href: "/v2/research", icon: Sparkles },
];

export function AnalyticsNav({ className }: { className?: string }) {
  return <PillNav items={ANALYTICS} className={className} />;
}

export function ImportNav({ className }: { className?: string }) {
  return <PillNav items={IMPORT} className={className} />;
}

export function CrmNav({ className }: { className?: string }) {
  return <PillNav items={CRM} className={className} />;
}
