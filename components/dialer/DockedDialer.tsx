'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Phone, Search, X } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import {
  CALL_LOGGED_EVENT,
  OWN_PHONE_EVENT,
  dialerDock,
  type CallLoggedDetail,
  type DockRequest,
} from '@/lib/telephony/dialerDock';
import { fetchCallerIds, searchTargets } from '@/lib/telephony/dialerClient';
import {
  AUTOMATIC_CALLER_ID,
  callerIdLabel,
  createLatestOnly,
  resolveCallerChoice,
  targetWarning,
  type CallerIdOption,
  type DialTarget,
} from '@/lib/telephony/dialerTargets';
import { getPhoneOutcome, type PhoneOutcomeId } from '@/lib/telephony/outcomes';
import { canClose, isLive } from '@/lib/telephony/softphoneMachine';

import { BlockedReasons, CallControls, DevicePicker, HangupButton, OutcomeForm } from './SoftphoneParts';
import { useDialerDock } from './useDialerDock';
import { useSoftphoneSession } from './useSoftphoneSession';

/**
 * The app-wide docked dialer: bottom-left, non-modal, folds to a bar, and survives navigation because it
 * is mounted once by `ClientLayoutAddons`. It owns the one softphone session. The rep picks a lead (or its
 * contact) from a search of leads they may work, picks which company number shows as caller ID, and calls;
 * the number always comes from the record on the server (ADR-001), never from this box.
 */

const SEARCH_DEBOUNCE_MS = 250;

const STATUS_TEXT = {
  idle: 'Starting the phone…',
  connecting: 'Connecting the phone…',
  registered: 'Phone ready',
  locked: 'Open in another tab',
  error: 'Phone not connected',
} as const;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function useTargetSearch(query: string) {
  const [state, setState] = useState<{ targets: DialTarget[]; error: string | null; loading: boolean }>({ targets: [], error: null, loading: false });
  const latest = useRef(createLatestOnly());
  useEffect(() => {
    const token = latest.current.begin();
    const controller = new AbortController();
    if (query.trim().length < 2) {
      setState({ targets: [], error: null, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const result = await searchTargets(query, { signal: controller.signal });
        if (!latest.current.isCurrent(token)) return;
        setState(result.ok ? { targets: result.targets, error: null, loading: false } : { targets: [], error: result.message, loading: false });
      } catch {
        // Aborted by a newer keystroke: that search owns the state now.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return state;
}

export default function DockedDialer() {
  const { showToast } = useToast();
  const dock = useDialerDock();
  const { rtc, state, stateRef, audioRef, devices, micId, speakerId, elapsed, talkSeconds, dial, hangup, toggleMute, toggleHold, dtmf, chooseMic, chooseSpeaker, saveOutcome, reset, resume } =
    useSoftphoneSession(dock.open);

  const [target, setTarget] = useState<DialTarget | null>(null);
  const [query, setQuery] = useState('');
  const [numbers, setNumbers] = useState<CallerIdOption[]>([]);
  const [numbersError, setNumbersError] = useState<string | null>(null);
  const [fromChoice, setFromChoice] = useState(AUTOMATIC_CALLER_ID);
  const [ownPhoneLeadId, setOwnPhoneLeadId] = useState<string | null>(null);
  /** Who the call in progress is for, kept past the picker so the outcome reaches the right drawer. */
  const callTargetRef = useRef<DialTarget | null>(null);
  const resumedRef = useRef(false);
  const search = useTargetSearch(target ? '' : query);

  // Company numbers, once, when the dock opens.
  useEffect(() => {
    let cancelled = false;
    void fetchCallerIds().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setNumbers(result.numbers);
        setNumbersError(null);
      } else {
        setNumbersError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const chosenFrom = resolveCallerChoice(fromChoice, numbers);

  // A new request from the drawer or the top bar. While a call is up it only brings the dock into view.
  const lastSeq = useRef(0);
  useEffect(() => {
    const request: DockRequest | null = dock.request;
    if (!request || request.seq === lastSeq.current) return;
    lastSeq.current = request.seq;
    if (isLive(stateRef.current) || stateRef.current.phase === 'wrap_up') return;
    reset();
    if (request.resumeCallId) {
      resumedRef.current = true;
      callTargetRef.current = request.target;
      setTarget(request.target);
      resume(request.resumeCallId);
    } else if (request.target) {
      setTarget(request.target);
      setQuery('');
    }
    setOwnPhoneLeadId(request.ownPhoneLeadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset and resume are stable; only a new request matters
  }, [dock.request]);

  const warning = target ? targetWarning(target) : null;
  const idle = state.phase === 'idle' || state.phase === 'blocked' || state.phase === 'error';
  const canDial = idle && rtc.status === 'registered' && Boolean(target) && !warning?.block;

  const startCall = () => {
    if (!target || !canDial) return;
    callTargetRef.current = target;
    resumedRef.current = false;
    void dial({ leadId: target.leadId, contactId: target.contactId, fromNumberId: chosenFrom || undefined });
  };

  const onSaveOutcome = async (outcome: PhoneOutcomeId, notes: string) => {
    const saved = await saveOutcome(outcome, notes);
    if (!saved) return;
    const label = getPhoneOutcome(saved)?.label ?? saved;
    showToast('Call logged', 'success');
    const detail: CallLoggedDetail = {
      leadId: callTargetRef.current?.leadId ?? null,
      activity: { action: saved, outcome: saved, label, notes: notes.trim() },
      meetingBooked: saved === 'connected_meeting_booked',
      resumed: resumedRef.current,
    };
    window.dispatchEvent(new CustomEvent(CALL_LOGGED_EVENT, { detail }));
  };

  const closable = canClose(state);
  const close = () => {
    if (closable) dialerDock.close();
  };

  // Escape folds nothing mid-call and closes nothing owed; it only closes a quiet dock.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && rootRef.current?.contains(document.activeElement) && canClose(stateRef.current)) {
        dialerDock.close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stateRef]);

  const headline = useMemo(() => {
    if (state.phase === 'ringing') return `Ringing… ${formatClock(elapsed)}`;
    if (state.phase === 'in_call') return `${state.held ? 'On hold' : state.muted ? 'Muted' : 'Connected'} ${formatClock(elapsed)}`;
    if (state.phase === 'connecting' || state.phase === 'checking') return 'Connecting…';
    if (state.phase === 'wrap_up') return 'Call ended';
    return STATUS_TEXT[rtc.status];
  }, [state, rtc.status, elapsed]);

  const field = 'w-full bg-bg-main border border-card-border rounded-lg p-1.5 text-text-primary';

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Dialer"
      className="fixed bottom-4 z-40 w-80 bg-card-bg border border-card-border rounded-2xl shadow-xl text-xs"
      style={{ left: 'calc(var(--sidebar-w, 56px) + 16px)' }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => dialerDock.setCollapsed(!dock.collapsed)}
          aria-expanded={!dock.collapsed}
          className="flex items-center gap-2 min-w-0 text-left"
        >
          <Phone className={`w-4 h-4 shrink-0 ${isLive(state) ? 'text-emerald-600' : 'text-text-muted'}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-semibold text-text-primary truncate">{target ? target.name : 'Dialer'}</span>
            <span role="status" className={`block type-meta ${rtc.status === 'registered' ? 'text-emerald-700' : 'text-text-muted'}`}>
              {headline}
            </span>
          </span>
          {dock.collapsed ? <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={!closable}
          aria-label="Close dialer"
          title={closable ? 'Close dialer' : 'Finish the call and save its outcome first'}
          className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-border/40 disabled:opacity-40"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!dock.collapsed && (
        <div className="px-3 pb-3 space-y-3 border-t border-card-border pt-3 max-h-[70vh] overflow-y-auto">
          {rtc.status === 'locked' && (
            <p role="alert" className="rounded-xl border border-brand-orange-text/30 bg-brand-orange-text/10 p-2 text-brand-orange-text leading-relaxed">
              The dialer is open in another tab.{' '}
              <button type="button" onClick={rtc.retry} className="underline font-semibold">
                Use it here
              </button>
            </p>
          )}
          {rtc.status === 'error' && !isLive(state) && state.phase !== 'wrap_up' && (
            <p role="alert" className="rounded-xl border border-brand-red/40 bg-brand-red/10 p-2 text-brand-red font-semibold">
              {rtc.error ?? 'The phone is not connected.'}{' '}
              <button type="button" onClick={rtc.retry} className="underline">
                Try again
              </button>
            </p>
          )}

          {idle && !target && (
            <div className="space-y-2">
              <label className="relative block">
                <span className="sr-only">Find a lead to call</span>
                <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-text-muted" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, company or phone"
                  className={`${field} pl-7`}
                  autoFocus
                />
              </label>
              {search.error && <p role="alert" className="text-brand-red">{search.error}</p>}
              {!search.error && query.trim().length >= 2 && !search.loading && search.targets.length === 0 && (
                <p className="text-text-muted">No lead you can call matches that.</p>
              )}
              <ul className="space-y-1" aria-label="Results">
                {search.targets.map((t) => (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setTarget(t);
                        setOwnPhoneLeadId(null);
                      }}
                      className="w-full text-left rounded-lg border border-card-border px-2 py-1.5 hover:bg-card-border/30"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-text-primary truncate">{t.name}</span>
                        {(t.doNotCall || t.suppressed) && <span className="text-brand-red font-semibold shrink-0">Do not call</span>}
                      </span>
                      <span className="block type-meta text-text-muted truncate">
                        {[t.kind === 'contact' ? 'Contact' : null, t.company, t.phone ?? 'No number'].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {target && (
            <div className="rounded-xl border border-card-border bg-bg-main/40 p-2.5 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary truncate">{target.name}</p>
                  {target.company && <p className="type-meta text-text-muted truncate">{target.company}</p>}
                </div>
                {idle && (
                  <button type="button" onClick={() => setTarget(null)} className="type-meta underline text-text-secondary shrink-0">
                    Change
                  </button>
                )}
              </div>
              <p className="font-mono text-sm font-semibold text-text-primary break-all">{target.phone ?? target.rawPhone ?? 'No number'}</p>
            </div>
          )}

          {warning && idle && (
            <p role="alert" className="rounded-xl border border-brand-red/40 bg-brand-red/10 p-2 text-brand-red font-semibold leading-relaxed">
              {warning.message}
            </p>
          )}

          {idle && target && (
            <label className="block space-y-1">
              <span className="font-bold text-text-secondary">From</span>
              <select className={field} value={chosenFrom} onChange={(e) => setFromChoice(e.target.value)}>
                <option value={AUTOMATIC_CALLER_ID}>Automatic (by destination country)</option>
                {numbers.map((n) => (
                  <option key={n.id} value={n.id}>
                    {callerIdLabel(n)}
                  </option>
                ))}
              </select>
              {numbersError && <span className="block text-brand-orange-text">{numbersError}</span>}
            </label>
          )}

          {state.phase === 'blocked' && <BlockedReasons reasons={state.reasons} dryRun={state.dryRun} localTime={state.localTime} timezone={state.timezone} />}
          {state.phase === 'error' && (
            <p role="alert" className="rounded-xl border border-brand-red/40 bg-brand-red/10 p-2 text-brand-red font-semibold leading-relaxed">
              {state.error.message}
            </p>
          )}
          {state.phase === 'in_call' && (
            <CallControls muted={state.muted} held={state.held} onMute={toggleMute} onHold={toggleHold} onDtmf={dtmf} />
          )}
          {state.phase === 'wrap_up' && (
            <OutcomeForm
              saving={state.saving}
              error={state.saveError}
              end={state.end}
              initialOutcome={state.end.suggestedOutcome}
              talkTime={state.answered && talkSeconds > 0 ? formatClock(talkSeconds) : null}
              onSubmit={onSaveOutcome}
            />
          )}
          {state.phase === 'saved' && <p role="status" className="font-semibold text-emerald-700">Call logged as {getPhoneOutcome(state.outcome)?.label}.</p>}

          {idle && <DevicePicker inputs={devices.inputs} outputs={devices.outputs} micId={micId} speakerId={speakerId} onMic={chooseMic} onSpeaker={chooseSpeaker} />}

          <div className="flex flex-wrap justify-end gap-2">
            {ownPhoneLeadId && target?.leadId === ownPhoneLeadId && idle && !warning?.block && (
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent(OWN_PHONE_EVENT, { detail: { leadId: ownPhoneLeadId } }));
                  dialerDock.close();
                }}
                className="px-3 py-1.5 border border-card-border rounded-lg text-text-secondary hover:text-text-primary"
              >
                Use my own phone
              </button>
            )}
            {isLive(state) && <HangupButton onClick={hangup} label={state.phase === 'checking' || state.phase === 'connecting' ? 'Cancel' : 'Hang up'} />}
            {idle && (
              <button type="button" onClick={startCall} disabled={!canDial} className="px-3 py-1.5 rounded-lg bg-brand-red text-white font-semibold disabled:opacity-50">
                {state.phase === 'idle' ? 'Call' : 'Try again'}
              </button>
            )}
            {state.phase === 'saved' && (
              <button
                type="button"
                onClick={() => {
                  reset();
                  setTarget(null);
                  setQuery('');
                }}
                className="px-3 py-1.5 rounded-lg bg-brand-red text-white font-semibold"
              >
                New call
              </button>
            )}
          </div>
        </div>
      )}
      <audio ref={audioRef} autoPlay />
    </div>
  );
}
