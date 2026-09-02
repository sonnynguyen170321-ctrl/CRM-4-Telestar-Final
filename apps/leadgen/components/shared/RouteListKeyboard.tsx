"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keyboard browsing for server-rendered, URL-driven tables (rows are <Link>, the open row is a
// query param). j/↓/→ next, k/↑/← prev navigate the ordered row hrefs — so an SDR can "lướt" through
// leads without the mouse. Ignores typing + modifiers (Cmd+K palette still works). Renders nothing.

export function RouteListKeyboard({
  hrefs,
  ids,
  activeId,
  enabled = true,
}: {
  hrefs: string[];
  ids: string[];
  activeId?: string | null;
  enabled?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || hrefs.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const cur = activeId ? ids.indexOf(activeId) : -1;
      if (e.key === "j" || e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = cur < 0 ? 0 : Math.min(cur + 1, hrefs.length - 1);
        if (hrefs[next]) router.push(hrefs[next]);
      } else if (e.key === "k" || e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = cur < 0 ? 0 : Math.max(cur - 1, 0);
        if (hrefs[prev]) router.push(hrefs[prev]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hrefs, ids, activeId, enabled, router]);
  return null;
}
