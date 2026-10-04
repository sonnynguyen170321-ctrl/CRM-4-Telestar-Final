'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Previous / next inside a detail drawer (owner request: step through the list without closing
 * the drawer). The page passes the ids it is showing, in the order it shows them; the drawer moves
 * along that list.
 *
 * `j` / `k` step forward / back, as in Gmail, but never while the person is typing — a `j` in a
 * note must stay a `j` — and never with a modifier held, so browser and OS shortcuts are untouched.
 */

export type DrawerNavigation = {
  /** 1-based position of the current record, or null when it is not in the list. */
  position: number | null;
  total: number;
  previousId: string | null;
  nextId: string | null;
  goPrevious: () => void;
  goNext: () => void;
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Pure: where `currentId` sits in `ids`, and its neighbours. Exported for tests.
 *
 * The record can leave the list while it is open — completing the last task on Home removes that
 * task's lead from the queue. `lastIndex` is where it was; the record that moved up into that slot
 * is then "next", so stepping through a shrinking queue still works.
 */
export function neighbours(ids: readonly string[], currentId: string | null, lastIndex: number | null = null) {
  const index = currentId ? ids.indexOf(currentId) : -1;
  if (index === -1) {
    if (lastIndex === null || ids.length === 0) return { position: null, previousId: null, nextId: null };
    return {
      position: null,
      previousId: lastIndex > 0 ? ids[Math.min(lastIndex, ids.length) - 1] : null,
      nextId: lastIndex < ids.length ? ids[lastIndex] : null,
    };
  }
  return {
    position: index + 1,
    previousId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

export function useDrawerNavigation(input: {
  currentId: string | null;
  siblingIds?: readonly string[];
  onNavigate?: (id: string) => void;
  /** True while something inside the drawer (a composer, a dialer) must not be navigated away from. */
  disabled?: boolean;
}): DrawerNavigation | null {
  const { currentId, siblingIds, onNavigate, disabled = false } = input;
  // Shown for a list of two or more, and for a record that has just left its list (so the person
  // can still move on); a one-item list has nowhere to go.
  const ids = useMemo(() => siblingIds ?? [], [siblingIds]);
  const enabled =
    !disabled && Boolean(onNavigate) && (ids.length > 1 || (ids.length > 0 && !ids.includes(currentId ?? '')));
  // Where the record last was in the list, kept so that it can leave the list (see `neighbours`).
  // Updated during render — React's pattern for state derived from props — not in an effect.
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const foundIndex = currentId ? ids.indexOf(currentId) : -1;
  if (foundIndex !== -1 && foundIndex !== lastIndex) setLastIndex(foundIndex);
  const place = useMemo(() => neighbours(ids, currentId, lastIndex), [ids, currentId, lastIndex]);

  const goPrevious = useCallback(() => {
    if (place.previousId) onNavigate?.(place.previousId);
  }, [place.previousId, onNavigate]);
  const goNext = useCallback(() => {
    if (place.nextId) onNavigate?.(place.nextId);
  }, [place.nextId, onNavigate]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTyping(event.target)) return;
      // A held key auto-repeats; each repeat would load a whole record. One step per press.
      if (event.repeat) return;
      if (event.key === 'j') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'k') {
        event.preventDefault();
        goPrevious();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, goNext, goPrevious]);

  if (!enabled) return null;
  return { ...place, total: ids.length, goPrevious, goNext };
}

/** The two buttons and the position, for a drawer header. */
export function DrawerNavButtons({ navigation, noun = 'record' }: { navigation: DrawerNavigation; noun?: string }) {
  const button =
    'p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-border/40 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed';
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={`Move between ${noun}s`}>
      <button
        type="button"
        onClick={navigation.goPrevious}
        disabled={!navigation.previousId}
        className={button}
        aria-label={`Previous ${noun}`}
        title={`Previous ${noun} (k)`}
      >
        <ChevronUp className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="min-w-[3.5rem] text-center font-mono text-[10px] text-text-muted" aria-live="polite">
        {navigation.position ?? '–'} / {navigation.total}
      </span>
      <button
        type="button"
        onClick={navigation.goNext}
        disabled={!navigation.nextId}
        className={button}
        aria-label={`Next ${noun}`}
        title={`Next ${noun} (j)`}
      >
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
