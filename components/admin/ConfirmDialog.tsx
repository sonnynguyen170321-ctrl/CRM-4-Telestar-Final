'use client';

import React, { useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';

interface Props {
  title: string;
  /** Rendered inside the dialog body — this is how ImpactPanel slots in. */
  body: React.ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  /** When set, the confirm button stays disabled until this string is typed. */
  requireTypedConfirm?: string;
  /** Blocks confirm while the parent is still gathering a required choice. */
  isConfirmDisabled?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The real confirm dialog, replacing `window.confirm` for admin actions.
 *
 * A native confirm cannot show impact counts, cannot offer a choice of handling
 * mode, and cannot be blocked until the operator has actually decided — all
 * three of which the removal flows require.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'default',
  requireTypedConfirm,
  isConfirmDisabled = false,
  isBusy = false,
  onConfirm,
  onClose,
}: Props) {
  useEscapeClose(onClose);
  const [typed, setTyped] = useState('');

  const typedOk = !requireTypedConfirm || typed === requireTypedConfirm;
  const canConfirm = typedOk && !isConfirmDisabled && !isBusy;

  const confirmClass =
    tone === 'danger'
      ? 'bg-brand-red hover:bg-brand-red-hover text-white'
      : 'bg-brand-red hover:bg-brand-red-hover text-white';

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={isBusy ? undefined : onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="bg-card-bg border border-card-border rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto max-h-[85vh] flex flex-col"
        >
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-card-border shrink-0">
            <h3 className="type-subsection font-bold text-text-primary flex items-center gap-2">
              {tone === 'danger' && (
                <AlertTriangle className="w-4 h-4 text-brand-red shrink-0" aria-hidden="true" />
              )}
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              aria-label="Close"
              className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-4 overflow-y-auto flex-1 text-xs text-text-secondary space-y-3">
            {body}

            {requireTypedConfirm && (
              <label className="block space-y-1.5 pt-1">
                <span className="text-xs font-semibold text-text-primary">
                  Type <span className="font-mono text-brand-red">{requireTypedConfirm}</span> to
                  confirm
                </span>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="w-full bg-bg-main border border-card-border rounded-lg px-3 py-1.5 text-text-primary focus:outline-none focus:border-brand-red text-xs"
                />
              </label>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-card-border shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="px-4 py-1.5 border border-card-border bg-bg-main hover:bg-card-border/30 text-text-secondary text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmClass}`}
            >
              {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
