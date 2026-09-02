import { Users, Filter, Download, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ProjectLeadsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Project Leads</h2>
          <p className="text-sm text-muted-foreground">Leads scoped to this project with ICP qualification results.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline">
            <Filter className="mr-1.5 h-4 w-4" />
            Filters
          </Button>
          <Button size="sm" variant="outline">
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">312</div>
            <p className="mt-1 text-xs text-muted-foreground">+18 this week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Qualified</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600">187</div>
            <p className="mt-1 text-xs text-muted-foreground">60% qualification rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Needs review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">43</div>
            <p className="mt-1 text-xs text-muted-foreground">14% require manual review</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lead table</CardTitle>
          <CardDescription>Full lead list with qualification badges, source, and actions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">Project-scoped lead workspace</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Displays leads assigned to this project with ICP scores, enrichment status, and bulk actions.
            </p>
            <Link
              href="/v2/workspace/leads"
              className="mt-4 inline-flex items-center text-sm font-medium text-primary hover:text-primary/80"
            >
              Go to lead workspace
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
