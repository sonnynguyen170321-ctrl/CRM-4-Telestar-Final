"use client";

import {
  BarChart3,
  FileText,
  Gauge,
  Inbox,
  MailPlus,
  Megaphone,
  ShieldOff,
  UserRoundCog,
} from "lucide-react";
import { PillNav } from "@/components/shared/PillNav";

const ITEMS = [
  { key: "monitor", label: "Monitor", href: "/v2/outreach", icon: Gauge },
  { key: "campaigns", label: "Campaigns", href: "/v2/outreach/campaigns", icon: Megaphone },
  { key: "inbox", label: "Inbox", href: "/v2/outreach/inbox", icon: Inbox },
  { key: "performance", label: "Performance", href: "/v2/outreach/performance", icon: BarChart3 },
  { key: "compose", label: "Compose", href: "/v2/outreach/compose", icon: MailPlus },
  { key: "templates", label: "Templates", href: "/v2/outreach/templates", icon: FileText },
  { key: "senders", label: "Senders", href: "/v2/outreach/senders", icon: UserRoundCog },
  { key: "suppression", label: "Suppression", href: "/v2/outreach/suppression", icon: ShieldOff },
  { key: "analytics", label: "Reports", href: "/v2/reports", icon: BarChart3 },
] as const;

export function CampaignNav({ active }: { active?: (typeof ITEMS)[number]["key"] }) {
  // active is unused because PillNav handles state via usePathname
  return <PillNav items={ITEMS} className="mb-2" />;
}
