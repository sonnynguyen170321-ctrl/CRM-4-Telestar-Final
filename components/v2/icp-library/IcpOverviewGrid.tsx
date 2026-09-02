"use client";

import { V2IcpRulesSummary } from "@/lib/v2/icp";

export function IcpOverviewGrid({ summary }: { summary: V2IcpRulesSummary }) {
  // We'll map existing rules to the new mock cards.
  // For the "Red Blindspot" mock data (Target Persona, Pain Points, Good/Bad fit),
  // we will inject static content indicating they need to be wired later.
  
  const companyAttrs = summary.companyTypeRules || [];
  const hardGates = summary.exclusions || summary.hardGates || [];
  const posSignals = summary.positiveSignals || [];
  const negSignals = summary.negativeSignals || [];
  const persona = summary.targetPersona || [];
  const goodFit = summary.goodFitExamples || [];
  const badFit = summary.badFitExamples || [];
  const painPoints = summary.painPoints || [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Card 1: Company Attributes */}
      <div className="bg-surface rounded-xl border border-hairline p-4 shadow-sm flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="font-semibold text-sm text-foreground">Company Attributes</h3>
        </div>
        <ul className="space-y-2 flex-1 text-sm text-muted-foreground">
          {companyAttrs.length > 0 ? companyAttrs.map((attr, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 bg-primary/40 rounded-full shrink-0"></span>
              <span>{attr.label}</span>
            </li>
          )) : (
            <li className="text-muted-foreground/60 italic">No attributes defined.</li>
          )}
        </ul>
        {companyAttrs.length > 4 && (
          <button className="text-primary text-xs font-medium mt-3 text-left">View all ({companyAttrs.length})</button>
        )}
      </div>

      {/* Card 2: Target Persona */}
      <div className="bg-surface rounded-xl border border-hairline p-4 shadow-sm flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h3 className="font-semibold text-sm text-foreground">Target Persona</h3>
        </div>
        <ul className="space-y-2 flex-1 text-sm text-muted-foreground">
          {persona.length > 0 ? persona.map((attr, idx) => (
            <li key={idx} className="flex flex-col gap-0.5 mb-2">
              <span className="font-semibold text-xs text-foreground/80">{attr.label}</span>
              <span>{attr.detail}</span>
            </li>
          )) : (
            <li className="text-muted-foreground/60 italic">Not defined.</li>
          )}
        </ul>
      </div>

      {/* Card 3: Pain Points */}
      <div className="bg-surface rounded-xl border border-hairline p-4 shadow-sm flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-orange-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="font-semibold text-sm text-foreground">Pain Points</h3>
        </div>
        <ul className="space-y-2 flex-1 text-sm text-muted-foreground">
          {painPoints.length > 0 ? painPoints.map((attr, idx) => (
            <li key={idx} className="flex flex-col gap-0.5 mb-2">
              <span className="font-semibold text-xs text-foreground/80">{attr.label}</span>
              <span>{attr.detail}</span>
            </li>
          )) : (
            <li className="text-muted-foreground/60 italic">Not defined.</li>
          )}
        </ul>
      </div>

      {/* Card 4: Exclusions (Mapped from Hard Gates) */}
      <div className="bg-surface rounded-xl border border-hairline p-4 shadow-sm flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-purple-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h3 className="font-semibold text-sm text-foreground">Exclusions</h3>
        </div>
        <ul className="space-y-2 flex-1 text-sm text-muted-foreground">
          {hardGates.length > 0 ? hardGates.map((gate, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 bg-purple-400/40 rounded-full shrink-0"></span>
              <span>{gate.label}</span>
            </li>
          )) : (
            <li className="text-muted-foreground/60 italic">No exclusions defined.</li>
          )}
        </ul>
        {hardGates.length > 4 && (
          <button className="text-primary text-xs font-medium mt-3 text-left">View all ({hardGates.length})</button>
        )}
      </div>

      {/* Card 5: Positive Signals */}
      <div className="bg-surface rounded-xl border border-hairline p-4 shadow-sm flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-emerald-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="font-semibold text-sm text-foreground">Positive Signals</h3>
        </div>
        <ul className="space-y-2 flex-1 text-sm text-muted-foreground">
          {posSignals.length > 0 ? posSignals.map((sig, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 bg-emerald-400/40 rounded-full shrink-0"></span>
              <span>{sig.label}</span>
            </li>
          )) : (
            <li className="text-muted-foreground/60 italic">No positive signals defined.</li>
          )}
        </ul>
        {posSignals.length > 4 && (
          <button className="text-primary text-xs font-medium mt-3 text-left">View all ({posSignals.length})</button>
        )}
      </div>

      {/* Card 6: Negative Signals */}
      <div className="bg-surface rounded-xl border border-hairline p-4 shadow-sm flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-red-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h3 className="font-semibold text-sm text-foreground">Negative Signals</h3>
        </div>
        <ul className="space-y-2 flex-1 text-sm text-muted-foreground">
          {negSignals.length > 0 ? negSignals.map((sig, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 bg-red-400/40 rounded-full shrink-0"></span>
              <span>{sig.label}</span>
            </li>
          )) : (
            <li className="text-muted-foreground/60 italic">No negative signals defined.</li>
          )}
        </ul>
        {negSignals.length > 4 && (
          <button className="text-primary text-xs font-medium mt-3 text-left">View all ({negSignals.length})</button>
        )}
      </div>

      {/* Card 7: Good Fit Examples */}
      <div className="bg-surface rounded-xl border border-hairline p-4 shadow-sm flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-emerald-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </div>
          <h3 className="font-semibold text-sm text-foreground">Good Fit Examples</h3>
        </div>
        <ul className="space-y-2 flex-1 text-sm text-muted-foreground">
          {goodFit.length > 0 ? goodFit.map((item, idx) => (
            <li key={idx} className="flex flex-col gap-0.5 mb-2">
              <span className="font-semibold text-xs text-foreground/80">{item.label}</span>
              {item.detail ? <span>{item.detail}</span> : null}
            </li>
          )) : (
            <li className="text-muted-foreground/60 italic">Not defined.</li>
          )}
        </ul>
      </div>

      {/* Card 8: Bad Fit Examples */}
      <div className="bg-surface rounded-xl border border-hairline p-4 shadow-sm flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-red-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="font-semibold text-sm text-foreground">Bad Fit Examples</h3>
        </div>
        <ul className="space-y-2 flex-1 text-sm text-muted-foreground">
          {badFit.length > 0 ? badFit.map((item, idx) => (
            <li key={idx} className="flex flex-col gap-0.5 mb-2">
              <span className="font-semibold text-xs text-foreground/80">{item.label}</span>
              {item.detail ? <span>{item.detail}</span> : null}
            </li>
          )) : (
            <li className="text-muted-foreground/60 italic">Not defined.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
