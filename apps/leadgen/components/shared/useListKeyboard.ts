"use client";

import { useCallback, useEffect, useState } from "react";

// Shared keyboard navigation for dense SDR tables: j/↓ next, k/↑ prev, Enter opens the row drawer,
// x toggles selection. Ignores keystrokes while typing in an input/textarea/select or with a
// modifier held (so Cmd+K etc. still reach the command palette). Returns the active row index so
// the table can highlight + scroll it into view.

export function useListKeyboard<T>(opts: {
  items: T[];
  onOpen?: (item: T, index: number) => void;
  onToggleSelect?: (item: T, index: number) => void;
  enabled?: boolean;
}): { activeIndex: number; setActiveIndex: (i: number) => void } {
  const { items, onOpen, onToggleSelect, enabled = true } = opts;
  const [activeIndex, setActiveIndex] = useState(-1);

  const isTyping = useCallback((el: EventTarget | null) => {
    const t = el as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
  }, []);

  useEffect(() => {
    if (!enabled || items.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1 < 0 ? 0 : i - 1, 0));
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        onOpen?.(items[activeIndex], activeIndex);
      } else if ((e.key === "x" || e.key === " ") && activeIndex >= 0) {
        e.preventDefault();
        onToggleSelect?.(items[activeIndex], activeIndex);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, activeIndex, enabled, onOpen, onToggleSelect, isTyping]);

  return { activeIndex, setActiveIndex };
}
