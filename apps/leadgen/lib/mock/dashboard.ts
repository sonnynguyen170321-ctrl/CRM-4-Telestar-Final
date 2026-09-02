export type DashboardStatId = "uploads" | "companies" | "qualified" | "uncertain";

export type DashboardStat = {
  id: DashboardStatId;
  label: string;
  value: string;
  description: string;
};

export const dashboardStats: DashboardStat[] = [
  {
    id: "uploads",
    label: "Uploads",
    value: "3",
    description: "Mock upload jobs staged for dashboard layout review.",
  },
  {
    id: "companies",
    label: "Companies",
    value: "1,240",
    description: "Sample company rows represented in local mock data.",
  },
  {
    id: "qualified",
    label: "Qualified",
    value: "312",
    description: "Static count only; scoring is not implemented yet.",
  },
  {
    id: "uncertain",
    label: "Uncertain",
    value: "87",
    description: "Placeholder review queue count for UI wiring.",
  },
];
