import { Crosshair, Plus, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const icps = [
  { name: "B2B SaaS VP Sales", status: "Published", version: 3, accounts: 28 },
  { name: "Mid-Market Tech", status: "Published", version: 2, accounts: 42 },
  { name: "Enterprise HR Leaders", status: "Draft", version: 1, accounts: 0 },
  { name: "SMB Founder-Led", status: "Review", version: 1, accounts: 15 },
];

export default function ProjectIcpsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">ICP Profiles</h2>
          <p className="text-sm text-muted-foreground">Ideal Customer Profile versions and their qualification criteria.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          New ICP version
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {icps.map((icp) => (
          <Card key={icp.name} className="group cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Crosshair className="h-5 w-5" />
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  icp.status === "Published" ? "bg-emerald-50 text-emerald-700" :
                  icp.status === "Draft" ? "bg-muted/40 text-muted-foreground" :
                  "bg-amber-50 text-amber-700"
                }`}>
                  {icp.status}
                </span>
              </div>
              <CardTitle className="mt-3 text-base">{icp.name}</CardTitle>
              <CardDescription>v{icp.version} &middot; {icp.accounts} accounts mapped</CardDescription>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">Hard rules</span>
                <span className="font-semibold text-foreground">8 active</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-muted-foreground">Soft signals</span>
                <span className="font-semibold text-foreground">12</span>
              </div>
            </CardContent>
            <CardFooter className="border-t pt-3">
              <Link href="#" className="inline-flex items-center text-xs font-medium text-primary hover:text-primary/80">
                Edit criteria
                <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
