"use client";

import { useState, useTransition } from "react";
import { runDiagnosticProbeAction } from "@/app/v2/workspace/leads/actions";
import type { HoleheResult } from "@/lib/v2/enrich/holehe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, Mail, Phone, Loader2, Sparkles, CheckCircle2, ShieldCheck, AlertCircle } from "lucide-react";

type ProbeResult = {
  success?: boolean;
  techStack?: string[];
  holeheResults?: HoleheResult[];
  phoneIntel?: { isValid: boolean; countryCode?: string | null; type?: string | null } | null;
};

export function EnrichmentPlayground() {
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ProbeResult | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain && !email && !phone) return;

    startTransition(async () => {
      const fd = new FormData();
      fd.append("domain", domain);
      fd.append("email", email);
      fd.append("phone", phone);

      const res = await runDiagnosticProbeAction(fd);
      if (res && "success" in res) {
        setResult(res);
      }
    });
  };

  return (
    <div className="bg-surface rounded-xl border border-hairline p-6 shadow-premium backdrop-blur-xl">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-primary animate-pulse" />
        <h3 className="text-lg font-bold text-foreground">SDR Enrichment Playground</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Test and run diagnostic queries directly against the OSINT and enrichment engines.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Domain</label>
            <div className="relative">
              <Globe className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="e.g. stripe.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="pl-9 bg-background/50 border-hairline"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="e.g. john@stripe.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9 bg-background/50 border-hairline"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Phone</label>
            <div className="relative">
              <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="e.g. +84900000000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="pl-9 bg-background/50 border-hairline"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-premium">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Probing...
              </>
            ) : (
              "Run Diagnostic Probe"
            )}
          </Button>
        </div>
      </form>

      {result && (
        <div className="mt-6 border-t border-hairline pt-6 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <h4 className="text-sm font-bold text-foreground">Diagnostic Results</h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Tech Stack */}
            <div className="bg-background/25 rounded-xl border border-hairline p-4">
              <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" /> Web Fingerprint
              </div>
              {result.techStack && result.techStack.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {result.techStack.map((tech: string) => (
                    <span key={tech} className="rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-semibold border border-primary/20">
                      {tech}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">No technology fingerprints detected.</div>
              )}
            </div>

            {/* Email Social Registrations */}
            <div className="bg-background/25 rounded-xl border border-hairline p-4">
              <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" /> Social Registrations
              </div>
              {result.holeheResults && result.holeheResults.length > 0 ? (
                <div className="space-y-2">
                  {result.holeheResults.map((r) => (
                    <div key={r.platform} className="flex items-center justify-between text-xs">
                      <span className="capitalize text-foreground/80 font-medium">{r.platform}</span>
                      <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                        <ShieldCheck className="w-3.5 h-3.5" /> Registered
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">No social registrations found.</div>
              )}
            </div>

            {/* Phone Intel */}
            <div className="bg-background/25 rounded-xl border border-hairline p-4">
              <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" /> Phone Intel
              </div>
              {result.phoneIntel ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valid format:</span>
                    <span className={`font-bold ${result.phoneIntel.isValid ? "text-emerald-600" : "text-red-500"}`}>
                      {result.phoneIntel.isValid ? "Yes" : "No"}
                    </span>
                  </div>
                  {result.phoneIntel.isValid && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Country:</span>
                        <span className="font-bold text-foreground">{result.phoneIntel.countryCode}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Type:</span>
                        <span className="font-bold text-primary">{result.phoneIntel.type}</span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">No phone data parsed.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
