"use client";

import { useEffect } from "react";

// Keyboard nav between drawer rows: ArrowRight / j = next, ArrowLeft / k = prev. Ignored while
// typing in a field or when a modifier is held, so it never hijacks normal input.
export function useDrawerKeyboardNav(opts: { enabled: boolean; onPrev: () => void; onNext: () => void }) {
  const { enabled, onPrev, onNext } = opts;
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        onNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onPrev, onNext]);
}
