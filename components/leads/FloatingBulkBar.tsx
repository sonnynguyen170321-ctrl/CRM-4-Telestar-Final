'use client';

import { 
  Sparkles, 
  X, 
  Check, 
  Loader2
} from 'lucide-react';
interface Sequence {
  id: string;
  name: string;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
}

interface FloatingBulkBarProps {
  selectedCount: number;
  sequences: Sequence[];
  users: User[];
  bulkStage: string;
  setBulkStage: (stage: string) => void;
  bulkSdr: string;
  setBulkSdr: (sdrId: string) => void;
  bulkSeqId: string;
  setBulkSeqId: (seqId: string) => void;
  onApply: () => void;
  onClear: () => void;
  isApplying: boolean;
  onBatchAiEnrich?: () => void;
}

export default function FloatingBulkBar({
  selectedCount,
  sequences,
  users,
  bulkStage,
  setBulkStage,
  bulkSdr,
  setBulkSdr,
  bulkSeqId,
  setBulkSeqId,
  onApply,
  onClear,
  isApplying,
  onBatchAiEnrich,
}: FloatingBulkBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-card-bg/95 backdrop-blur-xl border border-card-border/80 rounded-2xl shadow-2xl text-xs text-text-primary">
        {/* Count Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-brand-red/10 text-brand-red border border-brand-red/20 rounded-xl font-bold font-mono">
          <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse" />
          <span>{selectedCount} selected</span>
        </div>

        <div className="h-4 w-px bg-card-border/60 dark:bg-zinc-700" />

        {/* Change Stage */}
        <select
          value={bulkStage}
          onChange={(e) => setBulkStage(e.target.value)}
          className="bg-bg-main/80 dark:bg-zinc-800 border border-card-border dark:border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand-red transition-colors"
        >
          <option value="">🏷️ Change Stage…</option>
          {['new', 'sequence_active', 'replied', 'meeting_booked', 'won', 'lost'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').toUpperCase()}</option>
          ))}
        </select>

        {/* Assign Rep */}
        {users.length > 0 && (
          <select
            value={bulkSdr}
            onChange={(e) => setBulkSdr(e.target.value)}
            className="bg-bg-main/80 dark:bg-zinc-800 border border-card-border dark:border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand-red transition-colors"
          >
            <option value="">👤 Assign Rep…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </option>
            ))}
          </select>
        )}

        {/* Add to Sequence */}
        {sequences.length > 0 && (
          <select
            value={bulkSeqId}
            onChange={(e) => setBulkSeqId(e.target.value)}
            className="bg-bg-main/80 dark:bg-zinc-800 border border-card-border dark:border-zinc-700 rounded-xl px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand-red transition-colors"
          >
            <option value="">⚡ Add to Sequence…</option>
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}

        {/* Batch AI Enrich */}
        {onBatchAiEnrich && (
          <button
            type="button"
            onClick={onBatchAiEnrich}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-500/15 to-teal-500/15 border border-emerald-500/30 hover:border-emerald-500/60 text-emerald-400 font-semibold rounded-xl transition-all"
            title="Enrich company intelligence for all selected leads"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Enrich</span>
          </button>
        )}

        {/* Apply Button */}
        <button
          type="button"
          onClick={onApply}
          disabled={isApplying || (!bulkStage && !bulkSdr && !bulkSeqId)}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-red hover:bg-brand-red-hover text-white rounded-xl font-bold font-mono shadow-md disabled:opacity-40 transition-all cursor-pointer"
        >
          {isApplying ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          <span>Apply</span>
        </button>

        {/* Clear Selection */}
        <button
          type="button"
          onClick={onClear}
          className="p-1.5 text-text-muted hover:text-text-primary rounded-xl hover:bg-card-border/30 transition-colors"
          title="Clear Selection (ESC)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
