'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Phone, X } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import { dialWarning, phoneCallTarget, type DialFlags, type LoggedCall } from '@/lib/telephony/logPhoneCall';
import { getPhoneOutcome, type PhoneOutcomeId } from '@/lib/telephony/outcomes';
import { describeMicError, eventsForRtcState, requestCall, rtcErrorToSoftphoneError, saveCallOutcome } from '@/lib/telephony/softphoneFlow';
import {
  canClose,
  hasProviderCall,
  INITIAL_SOFTPHONE_STATE,
  isLive,
  softphoneReducer,
  type SoftphoneEvent,
} from '@/lib/telephony/softphoneMachine';
import type { RtcCallLike } from '@/lib/telephony/rtcController';

import { BlockedReasons, CallControls, DevicePicker, HangupButton, OutcomeForm, type DeviceOption } from './SoftphoneParts';
import { useTelnyxClient } from './useTelnyxClient';

/**
 * Call a lead from the browser (docs/dialer/TASKS.md Phase 5). The flow is the state machine in
 * lib/telephony/softphoneMachine.ts; this file turns browser and SDK events into its events.
 *
 * The call is placed only with the token `POST /api/telephony/calls` returns, passed as the call's
 * clientState: the provider parks the call until the server checks that token, so a call that skips
 * the gate never connects. The outcome form appears after hangup and the dialog cannot be closed
 * until it is saved.
 */

type Props = {
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    company?: string | null;
    phone?: string | null;
    contact?: ({ country?: string | null } & DialFlags['contact']) | null;
  } & Omit<DialFlags, 'contact'>;
  onClose: () => void;
  /** After the outcome is saved: the call to show in the timeline. */
  onLogged: (activity: LoggedCall) => void;
  /** "Meeting Booked" hands over to the drawer's booking form. */
  onMeetingBooked: () => void;
};

const STATUS_TEXT = {
  idle: 'Starting the phone…',
  connecting: 'Connecting the phone…',
  registered: 'Phone ready',
  locked: 'The dialer is open in another tab',
  error: 'The phone is not connected',
} as const;

type Notification = { type?: string; call?: RtcCallLike & { id?: string } };

const toOptions = (devices: MediaDeviceInfo[]): DeviceOption[] => devices.map((d) => ({ deviceId: d.deviceId, label: d.label }));

export default function Softphone({ lead, onClose, onLogged, onMeetingBooked }: Props) {
  const { showToast } = useToast();
  const rtc = useTelnyxClient(true);
  const [state, dispatchRaw] = useReducer(softphoneReducer, INITIAL_SOFTPHONE_STATE);
  const stateRef = useRef(state);
  const callRef = useRef<RtcCallLike | null>(null);
  const attemptRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const [devices, setDevices] = useState<{ inputs: DeviceOption[]; outputs: DeviceOption[] }>({ inputs: [], outputs: [] });
  const [micId, setMicId] = useState('');
  const [speakerId, setSpeakerId] = useState('');

  const target = useMemo(() => phoneCallTarget(lead.phone, lead.contact?.country), [lead.phone, lead.contact?.country]);
  const warning = dialWarning(lead);
  const shownNumber = target.e164 ?? lead.phone ?? '';

  const dispatch = useCallback((event: SoftphoneEvent) => {
    stateRef.current = softphoneReducer(stateRef.current, event);
    dispatchRaw(event);
  }, []);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const requestClose = useCallback(() => {
    if (canClose(stateRef.current)) onCloseRef.current();
  }, []);

  // Dialog: focus in on open and back to the Call button on close, Tab stays inside. Escape closes
  // only when there is nothing live and no outcome owed.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, select, [href]'));
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
  }, [requestClose]);

  // The tell-tale of a call in progress, for the client's token refresh and for the tab itself.
  useEffect(() => {
    rtc.setCallActive(hasProviderCall(state));
    if (!hasProviderCall(state)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setCallActive is stable
  }, [state.phase]);

  // Leaving with a call up (drawer navigated away): hang it up rather than leave it ringing.
  useEffect(
    () => () => {
      detachRef.current?.();
      try {
        callRef.current?.hangup();
      } catch {
        // The call is already gone.
      }
    },
    []
  );

  // Devices, once the phone is registered (labels need microphone permission; unlabeled until then).
  useEffect(() => {
    if (rtc.status !== 'registered') return;
    const client = rtc.getClient();
    if (!client) return;
    let cancelled = false;
    Promise.all([client.getAudioInDevices?.() ?? Promise.resolve([]), client.getAudioOutDevices?.() ?? Promise.resolve([])])
      .then(([inputs, outputs]) => {
        if (!cancelled) setDevices({ inputs: toOptions(inputs), outputs: toOptions(outputs) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rtc.status, rtc]);

  const watchCall = useCallback(
    (call: RtcCallLike & { id?: string }) => {
      const client = rtc.getClient();
      if (!client) return;
      detachRef.current?.();
      const listener = (notification: Notification) => {
        if (notification.type === 'userMediaError') {
          dispatch({ type: 'RTC_ERROR', error: describeMicError({ name: 'NotAllowedError' }) });
          return;
        }
        const updated = notification.call;
        if (notification.type !== 'callUpdate' || !updated) return;
        if (updated !== call && (updated.id === undefined || updated.id !== call.id)) return;
        eventsForRtcState(updated.state).forEach(dispatch);
      };
      client.on('telnyx.notification', listener as (payload: never) => void);
      detachRef.current = () => client.off?.('telnyx.notification', listener as (payload: never) => void);
    },
    [rtc, dispatch]
  );

  const dial = async () => {
    if (!isLive(stateRef.current) && stateRef.current.phase !== 'wrap_up') {
      const attempt = ++attemptRef.current;
      dispatch({ type: 'DIAL' });
      // Microphone first: the call token lives two minutes and a permission prompt can outlast it.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        if (attempt === attemptRef.current) dispatch({ type: 'CHECK_FAILED', error: describeMicError(error) });
        return;
      }
      const result = await requestCall({ leadId: lead.id });
      if (attempt !== attemptRef.current) return;
      if (result.kind === 'blocked') {
        dispatch({ type: 'CHECK_BLOCKED', reasons: result.reasons, dryRun: result.dryRun, localTime: result.localTime, timezone: result.timezone });
        return;
      }
      if (result.kind === 'error') {
        dispatch({ type: 'CHECK_FAILED', error: result.error });
        return;
      }
      dispatch({ type: 'CHECK_ALLOWED', callId: result.callId });
      const client = rtc.getClient();
      if (!client || rtc.status !== 'registered') {
        dispatch({ type: 'RTC_ERROR', error: { code: 'not_registered', message: 'The phone is not connected. Wait for "Phone ready" and try again.' } });
        return;
      }
      try {
        const call = client.newCall({
          destinationNumber: result.toE164,
          clientState: result.clientState,
          audio: true,
          remoteElement: audioRef.current ?? undefined,
          micId: micId || undefined,
          speakerId: speakerId || undefined,
        });
        callRef.current = call;
        watchCall(call);
      } catch (error) {
        dispatch({ type: 'RTC_ERROR', error: rtcErrorToSoftphoneError(error instanceof Error ? error.message : undefined) });
      }
    }
  };

  // A provider-level failure while a call is being set up or up.
  useEffect(() => {
    if (rtc.status === 'error' && isLive(stateRef.current) && stateRef.current.phase !== 'checking') {
      dispatch({ type: 'RTC_ERROR', error: rtcErrorToSoftphoneError(rtc.error ?? undefined) });
    }
  }, [rtc.status, rtc.error, dispatch]);

  const hangup = () => {
    if (stateRef.current.phase === 'checking') attemptRef.current += 1;
    try {
      callRef.current?.hangup();
    } catch {
      // Already ended at the provider; the state moves on regardless.
    }
    dispatch({ type: 'HANGUP' });
  };

  const toggleMute = () => {
    if (state.phase !== 'in_call' || !callRef.current) return;
    if (state.muted) callRef.current.unmuteAudio();
    else callRef.current.muteAudio();
    dispatch({ type: 'MUTED', muted: !state.muted });
  };

  const toggleHold = () => {
    if (state.phase !== 'in_call' || !callRef.current) return;
    if (state.held) void callRef.current.unhold();
    else void callRef.current.hold();
    dispatch({ type: 'RTC_HELD', held: !state.held });
  };

  const chooseMic = (deviceId: string) => {
    setMicId(deviceId);
    if (deviceId && hasProviderCall(state)) void callRef.current?.setAudioInDevice?.(deviceId);
  };
  const chooseSpeaker = (deviceId: string) => {
    setSpeakerId(deviceId);
    if (deviceId && hasProviderCall(state)) void callRef.current?.setAudioOutDevice?.(deviceId);
  };

  const saveOutcome = async (outcome: PhoneOutcomeId, notes: string) => {
    if (state.phase !== 'wrap_up' || state.saving) return;
    dispatch({ type: 'SAVE_STARTED' });
    const result = await saveCallOutcome({ callId: state.callId, outcome, notes });
    if (!result.ok) {
      dispatch({ type: 'SAVE_FAILED', message: result.error });
      return;
    }
    dispatch({ type: 'SAVE_SUCCEEDED', outcome });
    const label = getPhoneOutcome(outcome)?.label ?? outcome;
    showToast('Call logged', 'success');
    onLogged({ action: outcome, outcome, label, notes: notes.trim() });
    if (outcome === 'connected_meeting_booked') onMeetingBooked();
  };

  const canDial = (state.phase === 'idle' || state.phase === 'blocked' || state.phase === 'error') && rtc.status === 'registered' && !warning?.block && Boolean(target.e164);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="softphone-title">
      <div className="fixed inset-0 bg-black/40" onClick={requestClose} />
      <div ref={dialogRef} className="relative w-full max-w-lg bg-card-bg border border-card-border rounded-2xl shadow-xl p-5 space-y-4 text-xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="softphone-title" className="type-subsection font-bold text-text-primary flex items-center gap-2">
              <Phone className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              Call {lead.firstName} {lead.lastName}
            </h2>
            {lead.company && <p className="type-meta text-text-muted">{lead.company}</p>}
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={!canClose(state)}
            aria-label="Close"
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-border/40 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {warning && (
          <p
            role="alert"
            className={`rounded-xl border p-3 leading-relaxed font-semibold ${
              warning.block ? 'border-brand-red/40 bg-brand-red/10 text-brand-red' : 'border-brand-orange-text/30 bg-brand-orange-text/10 text-brand-orange-text'
            }`}
          >
            {warning.message}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border border-card-border rounded-xl p-3 bg-bg-main/40">
          <span className="font-mono text-lg font-semibold text-text-primary break-all">{shownNumber}</span>
          <span role="status" className={`type-meta ${rtc.status === 'registered' ? 'text-emerald-700' : 'text-text-muted'}`}>
            {STATUS_TEXT[rtc.status]}
          </span>
        </div>

        {rtc.status === 'locked' && (
          <p role="alert" className="rounded-xl border border-brand-orange-text/30 bg-brand-orange-text/10 p-3 text-brand-orange-text leading-relaxed">
            The dialer is open in another tab. Close it there, then{' '}
            <button type="button" onClick={rtc.retry} className="underline font-semibold">
              try again here
            </button>
            .
          </p>
        )}
        {rtc.status === 'error' && !isLive(state) && state.phase !== 'wrap_up' && (
          <p role="alert" className="rounded-xl border border-brand-red/40 bg-brand-red/10 p-3 text-brand-red leading-relaxed font-semibold">
            {rtc.error ?? 'The phone is not connected.'}{' '}
            <button type="button" onClick={rtc.retry} className="underline">
              Try again
            </button>
          </p>
        )}

        {!target.e164 && <p className="text-brand-orange-text leading-relaxed">This lead has no number that can be called. Add one on the lead first.</p>}

        {state.phase === 'blocked' && <BlockedReasons reasons={state.reasons} dryRun={state.dryRun} localTime={state.localTime} timezone={state.timezone} />}
        {state.phase === 'error' && (
          <p role="alert" className="rounded-xl border border-brand-red/40 bg-brand-red/10 p-3 text-brand-red leading-relaxed font-semibold">
            {state.error.message}
          </p>
        )}

        {state.phase === 'checking' && <p role="status">Checking the call is allowed…</p>}
        {state.phase === 'connecting' && <p role="status">Connecting…</p>}
        {state.phase === 'ringing' && <p role="status">Ringing…</p>}
        {state.phase === 'in_call' && (
          <div className="space-y-3">
            <p role="status" className="font-semibold text-emerald-700">
              {state.held ? 'On hold' : state.muted ? 'In call (you are muted)' : 'In call'}
            </p>
            <CallControls muted={state.muted} held={state.held} onMute={toggleMute} onHold={toggleHold} onDtmf={(digit) => callRef.current?.dtmf(digit)} />
          </div>
        )}

        {state.phase === 'wrap_up' && (
          <OutcomeForm
            saving={state.saving}
            error={state.saveError}
            endedNote={state.answered ? 'The call ended.' : state.endedBy === 'error' ? 'The call was interrupted.' : 'The call ended before it was answered.'}
            onSubmit={saveOutcome}
          />
        )}
        {state.phase === 'saved' && <p role="status" className="font-semibold text-emerald-700">Call logged as {getPhoneOutcome(state.outcome)?.label}.</p>}

        <DevicePicker inputs={devices.inputs} outputs={devices.outputs} micId={micId} speakerId={speakerId} onMic={chooseMic} onSpeaker={chooseSpeaker} />

        <div className="flex justify-end gap-2">
          {isLive(state) && <HangupButton onClick={hangup} label={state.phase === 'checking' || state.phase === 'connecting' ? 'Cancel' : 'Hang up'} />}
          {(state.phase === 'idle' || state.phase === 'blocked' || state.phase === 'error') && (
            <>
              <button type="button" onClick={requestClose} className="px-3 py-1.5 border border-card-border rounded-lg text-text-secondary hover:text-text-primary">
                Close
              </button>
              <button type="button" onClick={dial} disabled={!canDial} className="px-3 py-1.5 rounded-lg bg-brand-red text-white font-semibold disabled:opacity-50">
                {state.phase === 'idle' ? 'Call' : 'Try again'}
              </button>
            </>
          )}
          {state.phase === 'saved' && (
            <button type="button" onClick={requestClose} className="px-3 py-1.5 rounded-lg bg-brand-red text-white font-semibold">
              Done
            </button>
          )}
        </div>
        <audio ref={audioRef} autoPlay />
      </div>
    </div>
  );
}
