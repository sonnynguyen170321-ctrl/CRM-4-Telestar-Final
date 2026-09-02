"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, Users, Briefcase, Building2, MapPin, Search, LineChart, Target, AlertTriangle, ShieldX } from "lucide-react";
import { saveIcpDraftRulesAction } from "@/app/v2/icp-library/actions";
import type { IcpVersionRulesV2 } from "@/lib/v2/scoring/rules/schema-v2";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { REGION_TO_COUNTRIES } from "@/lib/v2/scoring/rules/dictionaries/regions";
import { INDUSTRY_KEYS } from "@/lib/v2/scoring/rules/dictionaries/industry";

const allCountries = Array.from(new Set(Object.values(REGION_TO_COUNTRIES).flat())).sort();

// Seniority tiers used for the persona floor (highest → lowest). Kept in sync with the
// scoring seniority dictionary.
const SENIORITY_TIERS_UI = ["C_LEVEL", "VP_LEVEL", "DIRECTOR", "MANAGER", "IC"] as const;
const WEIGHT_KEYS = ["geo", "industry", "companyType", "size", "persona", "signals"] as const;

export function IcpRulesEditor({ 
  initialRules, 
  draftVersionId, 
  expectedVersion,
  onCancel,
  onSaveSuccess
}: { 
  initialRules: IcpVersionRulesV2;
  draftVersionId: string;
  expectedVersion: number;
  onCancel: () => void;
  onSaveSuccess: () => void;
}) {
  const [rules, setRules] = useState<IcpVersionRulesV2>(initialRules);
  const [activeTab, setActiveTab] = useState("geography");
  const [isSaving, setIsSaving] = useState(false);
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append("draftVersionId", draftVersionId);
      formData.append("expectedVersion", expectedVersion.toString());
      formData.append("rulesJson", JSON.stringify(rules));
      
      const result = await saveIcpDraftRulesAction(formData);
      if (result.error) {
        alert(result.error);
      } else {
        onSaveSuccess();
      }
    } catch (err) {
      alert("Could not save.");
    } finally {
      setIsSaving(false);
    }
  };

  const tabs = [
    { id: "geography", label: "Geography", icon: Globe },
    { id: "industry", label: "Industry & Keywords", icon: Search },
    { id: "persona", label: "Target Persona", icon: Users },
    { id: "size", label: "Company Size", icon: Building2 },
    { id: "companyType", label: "Company Type", icon: Briefcase },
    { id: "negativeSignals", label: "Negative Signals", icon: AlertTriangle },
    { id: "goodFitExamples", label: "Good Fit Examples", icon: Target },
    { id: "badFitExamples", label: "Bad Fit Examples", icon: ShieldX },
    { id: "scoring", label: "Scoring & Confidence", icon: LineChart },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] bg-card rounded-xl shadow-sm border border-border">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/50">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Edit ICP Rules</h2>
          <p className="text-sm text-muted-foreground">Configure scoring logic for this draft.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Draft"}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r bg-muted/40 overflow-y-auto p-4 space-y-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive 
                    ? "bg-white text-primary shadow-sm border border-border" 
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 bg-card">
          <div className="max-w-2xl">
            {activeTab === "geography" && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-foreground mb-1">Target Countries</h3>
                      <p className="text-sm text-muted-foreground">Enter comma-separated country names to target.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="outline" size="sm">Browse A-Z</Button>
                        </SheetTrigger>
                        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                          <SheetHeader>
                            <SheetTitle>Select Target Countries</SheetTitle>
                            <SheetDescription>Select countries to target.</SheetDescription>
                          </SheetHeader>
                          <div className="mt-6 space-y-4">
                            <div className="grid grid-cols-2 gap-2">
                              {allCountries.map(c => (
                                <label key={c} className="flex items-center gap-2 text-sm text-foreground cursor-pointer hover:bg-muted/50 p-1 rounded">
                                  <input 
                                    type="checkbox" 
                                    className="rounded border-border text-primary"
                                    checked={rules.geography.targetCountries.includes(c)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setRules(prev => ({ ...prev, geography: { ...prev.geography, targetCountries: Array.from(new Set([...prev.geography.targetCountries, c])) } }));
                                      } else {
                                        setRules(prev => ({ ...prev, geography: { ...prev.geography, targetCountries: prev.geography.targetCountries.filter(x => x !== c) } }));
                                      }
                                    }}
                                  />
                                  {c}
                                </label>
                              ))}
                            </div>
                          </div>
                        </SheetContent>
                      </Sheet>
                      <label className="flex items-center gap-2 text-sm font-medium text-foreground bg-muted px-3 py-1.5 rounded-lg cursor-pointer hover:bg-muted">
                        <input 
                          type="checkbox"
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                          checked={rules.geography.targetCountries.length === 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRules(prev => ({ ...prev, geography: { ...prev.geography, targetCountries: [] } }));
                            }
                          }}
                        />
                        🌍 Worldwide (All)
                      </label>
                    </div>
                  </div>
                  <Input 
                    placeholder="e.g. United States, Canada, United Kingdom" 
                    value={rules.geography.targetCountries.join(", ")}
                    disabled={rules.geography.targetCountries.length === 0 && !rules.geography.targetCountries.includes("")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, geography: { ...prev.geography, targetCountries: val } }));
                    }}
                    className="bg-white"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {rules.geography.targetCountries.map(c => (
                      <span key={c} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent text-primary text-xs font-medium border border-primary/20">
                        <MapPin className="w-3 h-3" /> {c}
                      </span>
                    ))}
                    {rules.geography.targetCountries.length === 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-100">
                        <Globe className="w-3 h-3" /> Targeting Worldwide
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-medium text-foreground">Excluded Countries</h3>
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button variant="outline" size="sm">Browse A-Z</Button>
                      </SheetTrigger>
                      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                        <SheetHeader>
                          <SheetTitle>Select Excluded Countries</SheetTitle>
                          <SheetDescription>Select countries to explicitly exclude.</SheetDescription>
                        </SheetHeader>
                        <div className="mt-6 space-y-4">
                          <div className="grid grid-cols-2 gap-2">
                            {allCountries.map(c => (
                              <label key={c} className="flex items-center gap-2 text-sm text-foreground cursor-pointer hover:bg-muted/50 p-1 rounded">
                                <input 
                                  type="checkbox" 
                                  className="rounded border-border text-primary"
                                  checked={rules.geography.excludedCountries.includes(c)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setRules(prev => ({ ...prev, geography: { ...prev.geography, excludedCountries: Array.from(new Set([...prev.geography.excludedCountries, c])) } }));
                                    } else {
                                      setRules(prev => ({ ...prev, geography: { ...prev.geography, excludedCountries: prev.geography.excludedCountries.filter(x => x !== c) } }));
                                    }
                                  }}
                                />
                                {c}
                              </label>
                            ))}
                          </div>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">Countries explicitly blocked from qualification.</p>
                  <Input 
                    placeholder="e.g. India, Pakistan, Nigeria" 
                    value={rules.geography.excludedCountries.join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, geography: { ...prev.geography, excludedCountries: val } }));
                    }}
                    className="bg-white"
                  />
                </div>
              </div>
            )}

            {activeTab === "industry" && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div>
                  <h3 className="text-lg font-medium text-foreground mb-1">Industry Keywords</h3>
                  <p className="text-sm text-muted-foreground mb-4">Keywords that indicate a good industry fit (comma-separated).</p>
                  <Input 
                    placeholder="e.g. SaaS, Fintech, Healthcare" 
                    value={rules.industry.industryKeywords.join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, industry: { ...prev.industry, industryKeywords: val } }));
                    }}
                    className="bg-white"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-medium text-foreground">Target Industries</h3>
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button variant="outline" size="sm">Browse Industries</Button>
                      </SheetTrigger>
                      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                        <SheetHeader>
                          <SheetTitle>Select Target Industries</SheetTitle>
                          <SheetDescription>Select industries to explicitly include.</SheetDescription>
                        </SheetHeader>
                        <div className="mt-6 space-y-4">
                          <div className="grid grid-cols-2 gap-2">
                            {INDUSTRY_KEYS.map(ind => (
                              <label key={ind} className="flex items-center gap-2 text-sm text-foreground cursor-pointer hover:bg-muted/50 p-1 rounded">
                                <input 
                                  type="checkbox" 
                                  className="rounded border-border text-primary"
                                  checked={rules.industry.targetIndustries.includes(ind)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setRules(prev => ({ ...prev, industry: { ...prev.industry, targetIndustries: Array.from(new Set([...prev.industry.targetIndustries, ind])) } }));
                                    } else {
                                      setRules(prev => ({ ...prev, industry: { ...prev.industry, targetIndustries: prev.industry.targetIndustries.filter(x => x !== ind) } }));
                                    }
                                  }}
                                />
                                {ind.replace(/_/g, " ")}
                              </label>
                            ))}
                          </div>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">Specific industries to include.</p>
                  <Input 
                    placeholder="e.g. Software Development, Financial Services" 
                    value={rules.industry.targetIndustries.join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, industry: { ...prev.industry, targetIndustries: val } }));
                    }}
                    className="bg-white"
                  />
                </div>
                
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-medium text-foreground">Excluded Industries</h3>
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button variant="outline" size="sm">Browse Industries</Button>
                      </SheetTrigger>
                      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                        <SheetHeader>
                          <SheetTitle>Select Excluded Industries</SheetTitle>
                          <SheetDescription>Select industries to explicitly exclude.</SheetDescription>
                        </SheetHeader>
                        <div className="mt-6 space-y-4">
                          <div className="grid grid-cols-2 gap-2">
                            {INDUSTRY_KEYS.map(ind => (
                              <label key={ind} className="flex items-center gap-2 text-sm text-foreground cursor-pointer hover:bg-muted/50 p-1 rounded">
                                <input 
                                  type="checkbox" 
                                  className="rounded border-border text-primary"
                                  checked={rules.industry.excludedIndustries.includes(ind)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setRules(prev => ({ ...prev, industry: { ...prev.industry, excludedIndustries: Array.from(new Set([...prev.industry.excludedIndustries, ind])) } }));
                                    } else {
                                      setRules(prev => ({ ...prev, industry: { ...prev.industry, excludedIndustries: prev.industry.excludedIndustries.filter(x => x !== ind) } }));
                                    }
                                  }}
                                />
                                {ind.replace(/_/g, " ")}
                              </label>
                            ))}
                          </div>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">Specific industries to explicitly exclude.</p>
                  <Input 
                    placeholder="e.g. Real Estate, Construction" 
                    value={rules.industry.excludedIndustries.join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, industry: { ...prev.industry, excludedIndustries: val } }));
                    }}
                    className="bg-white"
                  />
                </div>
              </div>
            )}

            {activeTab === "persona" && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div>
                  <h3 className="text-lg font-medium text-foreground mb-1">Title Allowlist</h3>
                  <p className="text-sm text-muted-foreground mb-4">Specific job titles that match the persona.</p>
                  <Input 
                    placeholder="e.g. CEO, CMO, Founder" 
                    value={rules.persona.titleAllowlist.join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, persona: { ...prev.persona, titleAllowlist: val } }));
                    }}
                    className="bg-white"
                  />
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-1">Title Keywords</h3>
                  <p className="text-sm text-muted-foreground mb-4">Partial title matches (comma-separated). Weaker than the allowlist or tiers.</p>
                  <Input
                    placeholder="e.g. growth, revenue, demand gen"
                    value={rules.persona.titleKeywords.join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, persona: { ...prev.persona, titleKeywords: val } }));
                    }}
                    className="bg-white"
                  />
                </div>

                <div>
                  <h3 className="text-lg font-medium text-foreground mb-1">Seniority Floor</h3>
                  <p className="text-sm text-muted-foreground mb-4">Minimum seniority. Contacts below this are penalized (a junior IC won’t score like a VP).</p>
                  <select
                    value={rules.persona.seniorityFloor ?? ""}
                    onChange={(e) => setRules(prev => ({ ...prev, persona: { ...prev.persona, seniorityFloor: e.target.value ? (e.target.value as typeof SENIORITY_TIERS_UI[number]) : undefined } }))}
                    className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="">No floor</option>
                    {SENIORITY_TIERS_UI.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-lg font-medium text-foreground">Persona Title Tiers</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRules(prev => ({ ...prev, persona: { ...prev.persona, titleTiers: [...prev.persona.titleTiers, { tier: prev.persona.titleTiers.length + 1, titles: [], keywords: [], weight: 60 }] } }))}
                    >
                      + Add tier
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">Weighted tiers — e.g. VP titles score higher than managers. The engine takes the best-matching tier’s weight.</p>
                  <div className="space-y-3">
                    {rules.persona.titleTiers.length === 0 && (
                      <p className="text-sm italic text-muted-foreground">No tiers yet. Add one to grade titles (e.g. VP = 100, Director = 70).</p>
                    )}
                    {rules.persona.titleTiers.map((tier, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_90px_auto] items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
                        <Input
                          placeholder="Titles (comma)"
                          value={tier.titles.join(", ")}
                          onChange={(e) => {
                            const titles = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                            setRules(prev => ({ ...prev, persona: { ...prev.persona, titleTiers: prev.persona.titleTiers.map((t, j) => j === i ? { ...t, titles } : t) } }));
                          }}
                          className="bg-white"
                        />
                        <Input
                          placeholder="Keywords (comma)"
                          value={tier.keywords.join(", ")}
                          onChange={(e) => {
                            const keywords = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                            setRules(prev => ({ ...prev, persona: { ...prev.persona, titleTiers: prev.persona.titleTiers.map((t, j) => j === i ? { ...t, keywords } : t) } }));
                          }}
                          className="bg-white"
                        />
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="Weight"
                          value={tier.weight}
                          onChange={(e) => {
                            const weight = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                            setRules(prev => ({ ...prev, persona: { ...prev.persona, titleTiers: prev.persona.titleTiers.map((t, j) => j === i ? { ...t, weight } : t) } }));
                          }}
                          className="bg-white"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRules(prev => ({ ...prev, persona: { ...prev.persona, titleTiers: prev.persona.titleTiers.filter((_, j) => j !== i) } }))}
                          className="text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-muted/40 border rounded-lg">
                  <div>
                    <h4 className="font-medium text-foreground">Require Persona for Qualification</h4>
                    <p className="text-sm text-muted-foreground">If checked, leads without a matching persona will be rejected.</p>
                  </div>
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    checked={rules.persona.requirePersonaForFinalQualification}
                    onChange={(e) => setRules(prev => ({ ...prev, persona: { ...prev.persona, requirePersonaForFinalQualification: e.target.checked } }))}
                  />
                </div>
              </div>
            )}

            {activeTab === "size" && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-2">Min Employees</h3>
                    <Input 
                      type="number" 
                      placeholder="e.g. 10" 
                      value={rules.size.minEmployees ?? ""}
                      onChange={(e) => setRules(prev => ({ ...prev, size: { ...prev.size, minEmployees: e.target.value ? parseInt(e.target.value) : undefined } }))}
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-2">Max Employees</h3>
                    <Input 
                      type="number" 
                      placeholder="e.g. 500" 
                      value={rules.size.maxEmployees ?? ""}
                      onChange={(e) => setRules(prev => ({ ...prev, size: { ...prev.size, maxEmployees: e.target.value ? parseInt(e.target.value) : undefined } }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "companyType" && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center justify-between p-4 bg-muted/40 border rounded-lg">
                  <div>
                    <h4 className="font-medium text-foreground">Disqualify Services/Consulting</h4>
                    <p className="text-sm text-muted-foreground">Automatically reject companies categorized as pure services.</p>
                  </div>
                  <input 
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    checked={rules.companyType.servicesConsultingPolicy.disqualify} 
                    onChange={(e) => setRules(prev => ({ ...prev, companyType: { ...prev.companyType, servicesConsultingPolicy: { ...prev.companyType.servicesConsultingPolicy, disqualify: e.target.checked } } }))}
                  />
                </div>
              </div>
            )}

            {activeTab === "scoring" && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="bg-muted/40 border rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Target className="w-5 h-5 text-primary" />
                    <h3 className="text-lg font-medium text-foreground">Score Policy</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">Define how scores translate to qualification statuses.</p>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Min Score (Base)</label>
                      <Input 
                        type="number" 
                        value={rules.scorePolicy.minScore}
                        onChange={(e) => setRules(prev => ({ ...prev, scorePolicy: { ...prev.scorePolicy, minScore: parseInt(e.target.value) || 0 } }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Max Score (Ceiling)</label>
                      <Input 
                        type="number" 
                        value={rules.scorePolicy.maxScore}
                        onChange={(e) => setRules(prev => ({ ...prev, scorePolicy: { ...prev.scorePolicy, maxScore: parseInt(e.target.value) || 100 } }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Qualified Threshold</label>
                      <p className="text-xs text-muted-foreground mb-2">Scores above this are QUALIFIED.</p>
                      <Input 
                        type="number" 
                        value={rules.scorePolicy.qualifiedMinFitScore}
                        onChange={(e) => setRules(prev => ({ ...prev, scorePolicy: { ...prev.scorePolicy, qualifiedMinFitScore: parseInt(e.target.value) || 0 } }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Needs Review Threshold</label>
                      <p className="text-xs text-muted-foreground mb-2">Scores above this (but below qualified) are NEEDS REVIEW.</p>
                      <Input 
                        type="number" 
                        value={rules.scorePolicy.needsReviewMinFitScore}
                        onChange={(e) => setRules(prev => ({ ...prev, scorePolicy: { ...prev.scorePolicy, needsReviewMinFitScore: parseInt(e.target.value) || 0 } }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-muted/40 border rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-5 h-5 text-primary" />
                    <h3 className="text-lg font-medium text-foreground">Dimension Weights</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">
                    How much each dimension contributes to the fit score. Persona + industry weight is what makes a target VP beat a junior IC — should total 100.
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    {WEIGHT_KEYS.map((key) => (
                      <div key={key}>
                        <label className="mb-1 block text-xs font-medium capitalize text-muted-foreground">{key === "geo" ? "Geography" : key === "companyType" ? "Company type" : key}</label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={rules.scoringWeights[key]}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                            setRules(prev => ({ ...prev, scoringWeights: { ...prev.scoringWeights, [key]: v } }));
                          }}
                          className="bg-white"
                        />
                      </div>
                    ))}
                  </div>
                  <p className={`mt-3 text-sm font-medium ${WEIGHT_KEYS.reduce((s, k) => s + rules.scoringWeights[k], 0) === 100 ? "text-emerald-600" : "text-amber-600"}`}>
                    Total: {WEIGHT_KEYS.reduce((s, k) => s + rules.scoringWeights[k], 0)} {WEIGHT_KEYS.reduce((s, k) => s + rules.scoringWeights[k], 0) === 100 ? "✓" : "(must total 100)"}
                  </p>
                </div>

                <div className="bg-muted/40 border rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <LineChart className="w-5 h-5 text-primary" />
                    <h3 className="text-lg font-medium text-foreground">Confidence Policy</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">Define confidence thresholds based on data completeness.</p>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">High Confidence Threshold</label>
                      <Input 
                        type="number" 
                        value={rules.confidencePolicy.highConfidenceThreshold}
                        onChange={(e) => setRules(prev => ({ ...prev, confidencePolicy: { ...prev.confidencePolicy, highConfidenceThreshold: parseInt(e.target.value) || 0 } }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Medium Confidence Threshold</label>
                      <Input 
                        type="number" 
                        value={rules.confidencePolicy.mediumConfidenceThreshold}
                        onChange={(e) => setRules(prev => ({ ...prev, confidencePolicy: { ...prev.confidencePolicy, mediumConfidenceThreshold: parseInt(e.target.value) || 0 } }))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "negativeSignals" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="bg-muted/40 border rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    <h3 className="text-lg font-medium text-foreground">Negative Signals</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">Enter comma-separated keywords to penalize lead signals (-15 points per matched keyword).</p>
                  <Input 
                    placeholder="e.g. outsourcing, offshore, agency, consultant" 
                    value={(rules.negativeSignals || []).join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, negativeSignals: val }));
                    }}
                    className="bg-white"
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(rules.negativeSignals || []).map(keyword => (
                      <span key={keyword} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-50 text-red-700 text-xs font-semibold border border-red-200">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "goodFitExamples" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="bg-muted/40 border rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-lg font-medium text-foreground">Good Fit Examples</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">Enter comma-separated domains or company names that represent high compatibility fit (automatically boosts fit score to 100).</p>
                  <Input 
                    placeholder="e.g. vercel.com, stripe.com, figma" 
                    value={(rules.goodFitExamples || []).join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, goodFitExamples: val }));
                    }}
                    className="bg-white"
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(rules.goodFitExamples || []).map(ex => (
                      <span key={ex} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
                        {ex}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "badFitExamples" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="bg-muted/40 border rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldX className="w-5 h-5 text-red-600" />
                    <h3 className="text-lg font-medium text-foreground">Bad Fit Examples</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">Enter comma-separated domains or company names that represent low compatibility or mismatch (forces UNQUALIFIED status).</p>
                  <Input 
                    placeholder="e.g. upwork.com, fiverr.com, tcs.com" 
                    value={(rules.badFitExamples || []).join(", ")}
                    onChange={(e) => {
                      const val = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                      setRules(prev => ({ ...prev, badFitExamples: val }));
                    }}
                    className="bg-white"
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(rules.badFitExamples || []).map(ex => (
                      <span key={ex} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                        {ex}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
