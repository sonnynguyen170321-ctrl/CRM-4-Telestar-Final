"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";

import { useDrawerKeyboardNav } from "@/components/v2/shared/useDrawerKeyboardNav";
import type { CompanyDetailResult } from "@/lib/v2/company-intelligence/readModel";
import type { IcpBestMatchResult } from "@/lib/v2/crm/icpBestMatchRanking";

// Client-side company drawer (mirrors LeadDrawerProvider). A row click opens the drawer INSTANTLY
// from the row's snapshot (no full page reload), then this provider GETs
// /v2/crm/companies/[id]/drawer to hydrate the heavy detail — so the companies page no longer
// blocks its render on getCompanyDetail. A deep link (?companyId) auto-opens on mount; open/close
// sync the URL so refresh + share still work. Tenant safety stays server-side (session-scoped route).

export type CompanyDrawerSnapshot = {
  companyId: string;
  name: string | null;
  domain?: string | null;
};

type DrawerStatus = "closed" | "loading" | "loaded" | "error";

type CompanyDrawerValue = {
  status: DrawerStatus;
  snapshot: CompanyDrawerSnapshot | null;
  detail: CompanyDetailResult | null;
  bestMatch: IcpBestMatchResult | null;
  canOverride: boolean;
  open: (snapshot: CompanyDrawerSnapshot) => void;
  openById: (companyId: string) => void;
  retry: () => void;
  close: () => void;
  prev: () => void;
  next: () => void;
  canPrev: boolean;
  canNext: boolean;
  position: { index: number; total: number } | null;
};

const CompanyDrawerContext = createContext<CompanyDrawerValue | null>(null);

function syncUrl(companyId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (companyId) {
    url.searchParams.set("companyId", companyId);
  } else {
    url.searchParams.delete("companyId");
    url.searchParams.delete("leadPage");
  }
  window.history.replaceState(null, "", url.toString());
}

export function CompanyDrawerProvider({
  children,
  canOverride = false,
  initialSelectedCompanyId,
  orderedCompanyIds = [],
}: {
  children: ReactNode;
  canOverride?: boolean;
  initialSelectedCompanyId?: string;
  orderedCompanyIds?: string[];
}) {
  const [status, setStatus] = useState<DrawerStatus>(initialSelectedCompanyId ? "loading" : "closed");
  const [snapshot, setSnapshot] = useState<CompanyDrawerSnapshot | null>(
    initialSelectedCompanyId ? { companyId: initialSelectedCompanyId, name: null } : null
  );
  const [detail, setDetail] = useState<CompanyDetailResult | null>(null);
  const [bestMatch, setBestMatch] = useState<IcpBestMatchResult | null>(null);
  const requestRef = useRef(0);

  const kickFetch = useCallback((companyId: string) => {
    const token = ++requestRef.current;
    fetch(`/v2/crm/companies/${encodeURIComponent(companyId)}/drawer`, {
      headers: { accept: "application/json" },
    })
      .then(async (res) => {
        if (token !== requestRef.current) return; // superseded
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const body = (await res.json()) as { ok: boolean; detail?: CompanyDetailResult; bestMatch?: IcpBestMatchResult };
        if (token !== requestRef.current) return;
        if (body.ok && body.detail) {
          setDetail(body.detail);
          setBestMatch(body.bestMatch ?? null);
          setStatus("loaded");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (token === requestRef.current) setStatus("error");
      });
  }, []);

  const open = useCallback((next: CompanyDrawerSnapshot) => {
    setSnapshot(next);
    setStatus("loading");
    setDetail(null);
    setBestMatch(null);
    syncUrl(next.companyId);
    kickFetch(next.companyId);
  }, [kickFetch]);

  const openById = useCallback((companyId: string) => {
    open({ companyId, name: null });
  }, [open]);

  const retry = useCallback(() => {
    if (!snapshot) return;
    setStatus("loading");
    setDetail(null);
    kickFetch(snapshot.companyId);
  }, [snapshot, kickFetch]);

  const close = useCallback(() => {
    requestRef.current++; // cancel any in-flight fetch
    setStatus("closed");
    setSnapshot(null);
    setDetail(null);
    setBestMatch(null);
    syncUrl(null);
  }, []);

  const currentIndex = snapshot ? orderedCompanyIds.indexOf(snapshot.companyId) : -1;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < orderedCompanyIds.length - 1;
  const prev = useCallback(() => {
    if (currentIndex > 0) openById(orderedCompanyIds[currentIndex - 1]);
  }, [currentIndex, orderedCompanyIds, openById]);
  const next = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < orderedCompanyIds.length - 1) openById(orderedCompanyIds[currentIndex + 1]);
  }, [currentIndex, orderedCompanyIds, openById]);
  const position = useMemo(
    () => (currentIndex >= 0 ? { index: currentIndex + 1, total: orderedCompanyIds.length } : null),
    [currentIndex, orderedCompanyIds.length]
  );

  // ←/k and →/j move between companies while the drawer is open.
  useDrawerKeyboardNav({ enabled: snapshot !== null, onPrev: prev, onNext: next });

  // Deep link / refresh: seed status="loading" above, kick the fetch once on mount.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (initialSelectedCompanyId) kickFetch(initialSelectedCompanyId);
  }, [initialSelectedCompanyId, kickFetch]);

  // Sync to parent prop (search-param) changes made outside the provider.
  const prevIdRef = useRef<string | undefined>(initialSelectedCompanyId);
  useEffect(() => {
    if (initialSelectedCompanyId !== prevIdRef.current) {
      prevIdRef.current = initialSelectedCompanyId;
      /* eslint-disable react-hooks/set-state-in-effect */
      if (initialSelectedCompanyId) {
        openById(initialSelectedCompanyId);
      } else {
        close();
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [initialSelectedCompanyId, openById, close]);

  // Escape closes.
  useEffect(() => {
    if (status === "closed") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, close]);

  const value = useMemo<CompanyDrawerValue>(
    () => ({ status, snapshot, detail, bestMatch, canOverride, open, openById, retry, close, prev, next, canPrev, canNext, position }),
    [status, snapshot, detail, bestMatch, canOverride, open, openById, retry, close, prev, next, canPrev, canNext, position]
  );

  return <CompanyDrawerContext.Provider value={value}>{children}</CompanyDrawerContext.Provider>;
}

export function useCompanyDrawer(): CompanyDrawerValue {
  const ctx = useContext(CompanyDrawerContext);
  if (!ctx) throw new Error("useCompanyDrawer must be used within a CompanyDrawerProvider");
  return ctx;
}
