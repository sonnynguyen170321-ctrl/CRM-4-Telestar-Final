import { BarChart3, LineChart, PieChart, Download, ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const reports = [
  { name: "Pipeline overview", icon: BarChart3, desc: "Lead qualification funnel and conversion rates", color: "text-primary bg-accent" },
  { name: "Trend analysis", icon: LineChart, desc: "Lead volume and quality trends over time", color: "text-emerald-600 bg-emerald-50" },
  { name: "ICP breakdown", icon: PieChart, desc: "Qualification distribution across ICP profiles", color: "text-indigo-600 bg-indigo-50" },
];

export default function ProjectReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Reports</h2>
          <p className="text-sm text-muted-foreground">Dashboards and exports for project performance analysis.</p>
        </div>
        <Button size="sm" variant="outline">
          <Download className="mr-1.5 h-4 w-4" />
          Export all
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <Card key={r.name} className="group cursor-pointer transition-shadow hover:shadow-md">
              <CardHeader>
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${r.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="mt-3 text-base">{r.name}</CardTitle>
                <CardDescription>{r.desc}</CardDescription>
              </CardHeader>
              <CardFooter className="border-t pt-4">
                <Link href="#" className="inline-flex items-center text-xs font-medium text-primary hover:text-primary/80">
                  Open report
                  <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled reports</CardTitle>
          <CardDescription>Automated report delivery configuration.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-muted-foreground">No scheduled reports configured.</p>
            <Button variant="outline" size="sm" className="mt-3">
              <Plus className="mr-1.5 h-4 w-4" />
              Schedule report
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
