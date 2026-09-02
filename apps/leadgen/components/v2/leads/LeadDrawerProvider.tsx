"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";

import { useDrawerKeyboardNav } from "@/components/v2/shared/useDrawerKeyboardNav";
import type { LeadDrawerReadModel } from "@/lib/v2/crm/queryLeadDrawerReadModel";
import type { CampaignOption } from "@/components/v2/leads/AddToCampaignDialog";

// P5: client-side lead drawer. A row click opens the drawer INSTANTLY from the row's
// snapshot (no full page reload), then this provider GETs /v2/api/leads/[id]/drawer to
// hydrate the deep cards. The server page no longer pre-loads per-lead detail. A deep
// link (?selectedLeadId) auto-opens on mount; open/close sync the URL so refresh + share
// still work. Tenant safety stays server-side: the endpoint scopes by session org.

export type LeadDrawerSnapshot = {
  leadAssignmentId: string;
  contactName: string | null;
  contactTitle?: string | null;
  companyName: string | null;
};

type DrawerStatus = "closed" | "loading" | "loaded" | "error";

type LeadDrawerValue = {
  status: DrawerStatus;
  snapshot: LeadDrawerSnapshot | null;
  model: LeadDrawerReadModel | null;
  campaigns: CampaignOption[];
  open: (snapshot: LeadDrawerSnapshot) => void;
  openById: (leadAssignmentId: string) => void;
  retry: () => void;
  close: () => void;
  // Silent re-fetch of the current lead's model (no skeleton) — used to reconcile after an
  // optimistic desk action so the drawer shows canonical data without a full-page reload.
  refresh: () => void;
  // Deck navigation across the ranked queue (current page's order).
  prev: () => void;
  next: () => void;
  canPrev: boolean;
  canNext: boolean;
  position: { index: number; total: number } | null;
};

const LeadDrawerContext = createContext<LeadDrawerValue | null>(null);

function syncUrl(leadAssignmentId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (leadAssignmentId) url.searchParams.set("selectedLeadId", leadAssignmentId);
  else url.searchParams.delete("selectedLeadId");
  window.history.replaceState(null, "", url.toString());
}

export function LeadDrawerProvider({
  children,
  campaigns,
  initialSelectedLeadId,
  orderedLeadIds = [],
}: {
  children: ReactNode;
  campaigns: CampaignOption[];
  initialSelectedLeadId?: string;
  // The ranked order of the current page, so the deck can move prev/next without leaving.
  orderedLeadIds?: string[];
}) {
  // Deep link / refresh: render straight into the loading state for the URL's lead, so
  // the boot effect only has to kick the fetch (no synchronous setState in an effect).
  const [status, setStatus] = useState<DrawerStatus>(initialSelectedLeadId ? "loading" : "closed");
  const [snapshot, setSnapshot] = useState<LeadDrawerSnapshot | null>(
    initialSelectedLeadId ? { leadAssignmentId: initialSelectedLeadId, contactName: null, companyName: null } : null
  );
  const [model, setModel] = useState<LeadDrawerReadModel | null>(null);
  // Monotonic request token so a slow earlier fetch can't overwrite a newer open.
  const requestRef = useRef(0);

  // Fetch only — every setState here runs inside a promise callback (async), which keeps
  // it safe to call from the boot effect.
  const kickFetch = useCallback((leadAssignmentId: string) => {
    const token = ++requestRef.current;
    fetch(`/v2/api/leads/${encodeURIComponent(leadAssignmentId)}/drawer`, {
      headers: { accept: "application/json" },
    })
      .then(async (res) => {
        if (token !== requestRef.current) return; // superseded
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const body = (await res.json()) as { ok: boolean; model?: LeadDrawerReadModel };
        if (token !== requestRef.current) return;
        if (body.ok && body.model) {
          setModel(body.model);
          setStatus("loaded");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (token === requestRef.current) setStatus("error");
      });
  }, []);

  const open = useCallback((next: LeadDrawerSnapshot) => {
    setSnapshot(next);
    setStatus("loading");
    setModel(null);
    syncUrl(next.leadAssignmentId);
    kickFetch(next.leadAssignmentId);
  }, [kickFetch]);

  const openById = useCallback((leadAssignmentId: string) => {
    open({ leadAssignmentId, contactName: null, companyName: null });
  }, [open]);

  const retry = useCallback(() => {
    if (!snapshot) return;
    setStatus("loading");
    setModel(null);
    kickFetch(snapshot.leadAssignmentId);
  }, [snapshot, kickFetch]);

  const close = useCallback(() => {
    requestRef.current++; // cancel any in-flight fetch
    setStatus("closed");
    setSnapshot(null);
    setModel(null);
    syncUrl(null);
  }, []);

  // Silent reconcile: re-fetch WITHOUT flipping to the skeleton, so the current cards stay
  // visible until the fresh model swaps in (used after an optimistic desk action).
  const refresh = useCallback(() => {
    if (snapshot) kickFetch(snapshot.leadAssignmentId);
  }, [snapshot, kickFetch]);

  // Deck navigation across the current page's ranked order.
  const currentIndex = snapshot ? orderedLeadIds.indexOf(snapshot.leadAssignmentId) : -1;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < orderedLeadIds.length - 1;
  const prev = useCallback(() => {
    if (currentIndex > 0) openById(orderedLeadIds[currentIndex - 1]);
  }, [currentIndex, orderedLeadIds, openById]);
  const next = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < orderedLeadIds.length - 1) openById(orderedLeadIds[currentIndex + 1]);
  }, [currentIndex, orderedLeadIds, openById]);
  const position = useMemo(
    () => (currentIndex >= 0 ? { index: currentIndex + 1, total: orderedLeadIds.length } : null),
    [currentIndex, orderedLeadIds.length]
  );

  // ←/k and →/j move between leads while the drawer is open.
  useDrawerKeyboardNav({ enabled: snapshot !== null, onPrev: prev, onNext: next });

  // Deep link / refresh: the initializers above seed status="loading" + the snapshot, but nothing
  // kicks the hydrate fetch on mount — the sync effect below only reacts to LATER prop changes
  // (prevIdRef starts equal to initialSelectedLeadId). Without this boot effect, refreshing the page
  // with the drawer open (the URL always carries ?selectedLeadId) hangs on the skeleton forever.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (initialSelectedLeadId) kickFetch(initialSelectedLeadId);
  }, [initialSelectedLeadId, kickFetch]);

  // Synchronize drawer state with parent prop updates (e.g. Next.js page search params updates).
  const prevIdRef = useRef<string | undefined>(initialSelectedLeadId);
  useEffect(() => {
    if (initialSelectedLeadId !== prevIdRef.current) {
      prevIdRef.current = initialSelectedLeadId;
      // Sync drawer state to parent prop (search-param) changes — intentional.
      /* eslint-disable react-hooks/set-state-in-effect */
      if (initialSelectedLeadId) {
        openById(initialSelectedLeadId);
      } else {
        close();
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [initialSelectedLeadId, openById, close]);

  // Escape closes.
  useEffect(() => {
    if (status === "closed") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, close]);

  const value = useMemo<LeadDrawerValue>(
    () => ({ status, snapshot, model, campaigns, open, openById, retry, close, refresh, prev, next, canPrev, canNext, position }),
    [status, snapshot, model, campaigns, open, openById, retry, close, refresh, prev, next, canPrev, canNext, position]
  );

  return <LeadDrawerContext.Provider value={value}>{children}</LeadDrawerContext.Provider>;
}

export function useLeadDrawer(): LeadDrawerValue {
  const ctx = useContext(LeadDrawerContext);
  if (!ctx) throw new Error("useLeadDrawer must be used within a LeadDrawerProvider");
  return ctx;
}
