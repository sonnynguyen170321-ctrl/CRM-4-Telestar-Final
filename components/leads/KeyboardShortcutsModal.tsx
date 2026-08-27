'use client';

import React from 'react';
import { X, Keyboard } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'J / ↓', desc: 'Move to next lead row' },
  { key: 'K / ↑', desc: 'Move to previous lead row' },
  { key: 'Space / ↵', desc: 'Open lead detail slide-over drawer' },
  { key: 'X', desc: 'Toggle selection checkbox for active lead' },
  { key: 'E', desc: 'Quick compose outreach email' },
  { key: 'S', desc: 'Quick switch lead pipeline stage' },
  { key: 'A', desc: 'Run AI research dossier & personalized opener' },
  { key: '⌘K / /', desc: 'Global Spotlight Command Bar' },
  { key: '?', desc: 'Open this Keyboard Shortcuts cheat sheet' },
  { key: 'ESC', desc: 'Close open modal / Clear row selections' },
];

export default function KeyboardShortcutsModal({ isOpen, onClose }: Props) {
  useEscapeClose(onClose);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-card-bg border border-card-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-card-border">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-brand-red" />
            <h2 className="font-display font-bold text-sm text-text-primary">
              SDR Speedrun Keyboard Shortcuts
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-card-border/30 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2.5 max-h-[70vh] overflow-y-auto">
          {SHORTCUTS.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between py-1.5 px-2.5 rounded-xl hover:bg-card-border/20 transition-colors"
            >
              <span className="text-xs text-text-secondary">{item.desc}</span>
              <kbd className="px-2 py-0.5 bg-bg-main border border-card-border rounded-md font-mono text-[11px] font-bold text-text-primary shadow-xs">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 bg-bg-main/50 dark:bg-zinc-950/50 border-t border-card-border dark:border-zinc-800 text-[11px] text-text-muted text-center">
          Pro-tip: Press <kbd className="font-mono px-1 py-0.5 bg-card-bg border rounded text-[10px]">?</kbd> anytime on the Leads workspace to view shortcuts.
        </div>
      </div>
    </div>
  );
}
