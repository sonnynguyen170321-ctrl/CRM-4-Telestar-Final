'use client';

import React, { useEffect, useRef } from 'react';

export interface PickerItem {
  id: string;
  label: string;
  hint?: string;
}

interface PickerListProps {
  items: readonly PickerItem[];
  activeIndex: number;
  onPick: (item: PickerItem) => void;
  onHover?: (index: number) => void;
  emptyText: string;
  /** Names the list for assistive technology. */
  label: string;
  listId: string;
}

/**
 * The list shared by the variable picker and the snippet menu, whether it was opened by a toolbar
 * button or by typing `{{` or `/`. Keyboard handling lives with the opener (the editor keeps focus);
 * this only renders the options and the active one.
 */
export function PickerList({ items, activeIndex, onPick, onHover, emptyText, label, listId }: PickerListProps) {
  const activeRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  if (items.length === 0) {
    return <p className="px-3 py-2 text-xs text-text-muted">{emptyText}</p>;
  }
  return (
    <ul id={listId} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto py-1">
      {items.map((item, index) => (
        <li
          key={item.id}
          id={`${listId}-${index}`}
          ref={index === activeIndex ? activeRef : undefined}
          role="option"
          aria-selected={index === activeIndex}
          // mousedown, not click: the editor must not lose its selection before the pick is applied.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
          onMouseEnter={() => onHover?.(index)}
          className={`cursor-pointer px-3 py-1.5 text-xs ${index === activeIndex ? 'bg-brand-red/10 text-text-primary' : 'text-text-secondary'}`}
        >
          <span className="font-semibold">{item.label}</span>
          {item.hint ? <span className="ml-2 text-text-muted">{item.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Closes a popover on an outside press or Escape. */
export function useDismiss(open: boolean, onClose: () => void, containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPress = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as globalThis.Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Claimed here so an enclosing dialog (which closes on Escape) can tell it was already used.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onPress);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPress);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, containerRef]);
}
