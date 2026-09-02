import type { LucideIcon } from "lucide-react";

import { MetricCard } from "@/components/shared/MetricCard";

type StatCardProps = {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
};

export function StatCard({ title, value, description, icon: Icon }: StatCardProps) {
  return (
    <MetricCard label={title} value={value} description={description} icon={Icon} />
  );
}
