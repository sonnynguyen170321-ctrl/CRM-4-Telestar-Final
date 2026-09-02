import { Package, Plus, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const products = [
  { name: "LeadGen AI", stage: "Active", leads: 142, rate: 68 },
  { name: "SDR Copilot", stage: "Active", leads: 89, rate: 72 },
  { name: "Market Intel", stage: "Draft", leads: 0, rate: 0 },
  { name: "Outreach Pro", stage: "Active", leads: 203, rate: 81 },
];

export default function ProjectProductsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Products</h2>
          <p className="text-sm text-muted-foreground">Manage product lines and track lead attribution per product.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Add product
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <Card key={p.name} className="group cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Package className="h-5 w-5" />
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  p.stage === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-muted/40 text-muted-foreground"
                }`}>
                  {p.stage}
                </span>
              </div>
              <CardTitle className="mt-3 text-base">{p.name}</CardTitle>
              <CardDescription>Product profile with ICP mapping and lead attribution.</CardDescription>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="font-semibold text-foreground">{p.leads}</span>
                  <span className="ml-1 text-muted-foreground">leads</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">{p.rate}%</span>
                  <span className="ml-1 text-muted-foreground">qualified</span>
                </div>
              </div>
            </CardContent>
            <CardFooter className="border-t pt-3">
              <Link href="#" className="inline-flex items-center text-xs font-medium text-primary hover:text-primary/80">
                View details
                <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
