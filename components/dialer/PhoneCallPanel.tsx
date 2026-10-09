'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Phone, X } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import { logPhoneCall, NOTES_MAX, phoneCallTarget, type LoggedCall } from '@/lib/telephony/logPhoneCall';
import { PHONE_OUTCOMES, telUri, type PhoneOutcomeId } from '@/lib/telephony/phoneOutcomes';

/**
 * Call a lead from your own phone, then log it (owner, 2026-10-08: "for Vietnam, reps call on their
 * phone and log it"). Until the browser dialer is live this is the Call button for every lead —
 * MicroSIP users copy the number, phone users scan the code.
 *
 * The outcome is required: a call is logged only with what happened on it, the same rule as the
 * task Call Logging modal.
 */

type Props = {
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    company?: string | null;
    phone?: string | null;
    contact?: { country?: string | null } | null;
  };
  onClose: () => void;
  /** After a call is logged: the activity to show in the timeline. */
  onLogged: (activity: LoggedCall) => void;
  /** "Meeting Booked" hands over to the drawer's booking form. */
  onMeetingBooked: () => void;
};

const GROUPS = ['No contact', 'Connected', 'Follow-up'] as const;

export default function PhoneCallPanel({ lead, onClose, onLogged, onMeetingBooked }: Props) {
  const { showToast } = useToast();
  const target = useMemo(() => phoneCallTarget(lead.phone, lead.contact?.country), [lead.phone, lead.contact?.country]);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [outcome, setOutcome] = useState<PhoneOutcomeId | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // The latest close handler, read at key time: the parent passes a new function on every render,
  // and re-running the effect for it would pull focus back to the first button each time.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // A dialog: focus moves in on open and back to the Call button on close, Escape closes, and Tab
  // stays inside while it is open.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector<HTMLElement>('button[aria-pressed]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !formRef.current) return;
      const focusable = Array.from(
        formRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, [href]')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (!target.e164) return;
    let cancelled = false;
    let link: string;
    try {
      link = telUri(target.e164);
    } catch {
      setQrSvg(null);
      return;
    }
    // The SVG is generated from the number alone; nothing a user typed is placed in it as markup.
    QRCode.toString(link, { type: 'svg', margin: 1, width: 168, errorCorrectionLevel: 'M' })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [target.e164]);

  const shownNumber = target.e164 ?? lead.phone ?? '';

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(shownNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast('Could not copy — select the number instead', 'error');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome || saving) return;
    setSaving(true);
    try {
      const result = await logPhoneCall({ lead, outcome, notes });
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      result.warnings.forEach((warning) => showToast(warning, 'error'));
      showToast('Call logged', 'success');
      onLogged(result.activity);
      if (outcome === 'connected_meeting_booked') onMeetingBooked();
      onClose();
    } catch {
      showToast('Network error logging the call', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="phone-call-title">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <form
        ref={formRef}
        onSubmit={submit}
        className="relative w-full max-w-lg bg-card-bg border border-card-border rounded-2xl shadow-xl p-5 space-y-4 text-xs"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="phone-call-title" className="type-subsection font-bold text-text-primary flex items-center gap-2">
              <Phone className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              Call {lead.firstName} {lead.lastName}
            </h2>
            {lead.company && <p className="type-meta text-text-muted">{lead.company}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-border/40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-4 border border-card-border rounded-xl p-3 bg-bg-main/40">
          {target.e164 && qrSvg ? (
            <div
              className="shrink-0 bg-white rounded-lg p-1"
              aria-label={`QR code to dial ${shownNumber}`}
              role="img"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : null}
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-semibold text-text-primary break-all">{shownNumber}</span>
              <button
                type="button"
                onClick={copyNumber}
                className="inline-flex items-center gap-1 px-2 py-1 border border-card-border rounded-lg text-text-secondary hover:text-text-primary hover:bg-card-border/30"
              >
                {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {target.e164 ? (
              <p className="text-text-secondary leading-relaxed">
                Scan the code with your phone camera to dial
                {target.isVietnam ? '.' : ', or paste the number into MicroSIP.'} Then log what happened below.
              </p>
            ) : (
              <p className="text-brand-orange-text leading-relaxed">
                This number could not be read as a dialable phone number. Check it on the lead before calling.
              </p>
            )}
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-text-secondary">
            Call outcome <span className="text-brand-red" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </legend>
          {GROUPS.map((group) => (
            <div key={group} className="space-y-1">
              <div className="type-micro font-semibold uppercase tracking-wide text-text-muted">{group}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {PHONE_OUTCOMES.filter((o) => o.group === group).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={outcome === o.id}
                    onClick={() => setOutcome(o.id)}
                    className={`py-1.5 px-2 rounded-lg font-semibold border text-left transition-colors ${
                      outcome === o.id
                        ? 'bg-brand-red/10 border-brand-red/30 text-brand-red'
                        : 'bg-bg-main border-card-border text-text-secondary hover:text-text-primary hover:border-brand-red/30'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        <label className="block space-y-1">
          <span className="text-xs font-bold text-text-secondary">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={NOTES_MAX}
            className="w-full bg-bg-main border border-card-border rounded-lg p-2 text-text-primary focus:outline-none focus:border-brand-red resize-none"
            placeholder="What was said, next step…"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border border-card-border rounded-lg text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!outcome || saving}
            className="px-3 py-1.5 rounded-lg bg-brand-red text-white font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Log call'}
          </button>
        </div>
      </form>
    </div>
  );
}
