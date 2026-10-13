'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { FINAL_CALL_STATUSES, rawHangupFromRow } from '@/lib/telephony/hangupReason';
import type { PhoneOutcomeId } from '@/lib/telephony/outcomes';
import type { RtcCallLike } from '@/lib/telephony/rtcController';
import {
  describeMicError,
  eventsForRtcState,
  fetchCallRow,
  requestCall,
  rtcErrorToSoftphoneError,
  saveCallOutcome,
  sdkHangup,
} from '@/lib/telephony/softphoneFlow';
import {
  hasProviderCall,
  INITIAL_SOFTPHONE_STATE,
  isLive,
  softphoneReducer,
  type SoftphoneEvent,
} from '@/lib/telephony/softphoneMachine';
import { BUSY, playTone, RINGBACK } from '@/lib/telephony/tones';

import type { DeviceOption } from './SoftphoneParts';
import { useTelnyxClient } from './useTelnyxClient';

/**
 * The one browser softphone session (docs/dialer/TASKS.md Phase 5), as a hook the docked dialer owns.
 * The flow is the state machine in lib/telephony/softphoneMachine.ts; this turns browser and SDK events
 * into its events and keeps the SDK call object, timers, tones and devices.
 *
 * The call is placed only with the token `POST /api/telephony/calls` returns, passed as the call's
 * clientState: the provider parks the call until the server checks that token. The Telnyx client
 * registers only while `rtcEnabled` is true (the dock is open), and the tab lock is released when it
 * stops.
 */

type Notification = { type?: string; call?: RtcCallLike & { id?: string } };

export type DialRequest = { leadId: string; contactId?: string | null; fromNumberId?: string };

const toOptions = (devices: MediaDeviceInfo[]): DeviceOption[] => devices.map((d) => ({ deviceId: d.deviceId, label: d.label }));
const POLL_MS = 2500;

export function useSoftphoneSession(rtcEnabled: boolean) {
  const rtc = useTelnyxClient(rtcEnabled);
  const [state, dispatchRaw] = useReducer(softphoneReducer, INITIAL_SOFTPHONE_STATE);
  const stateRef = useRef(state);
  const callRef = useRef<RtcCallLike | null>(null);
  const attemptRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const [devices, setDevices] = useState<{ inputs: DeviceOption[]; outputs: DeviceOption[] }>({ inputs: [], outputs: [] });
  const [micId, setMicId] = useState('');
  const [speakerId, setSpeakerId] = useState('');

  const dispatch = useCallback((event: SoftphoneEvent) => {
    stateRef.current = softphoneReducer(stateRef.current, event);
    dispatchRaw(event);
  }, []);

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

  // Closing the page with a call up: hang it up rather than leave it ringing.
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
        eventsForRtcState(updated.state, sdkHangup(updated)).forEach(dispatch);
      };
      client.on('telnyx.notification', listener as (payload: never) => void);
      detachRef.current = () => client.off?.('telnyx.notification', listener as (payload: never) => void);
    },
    [rtc, dispatch]
  );

  const dial = async (request: DialRequest) => {
    const phase = stateRef.current.phase;
    if (phase !== 'idle' && phase !== 'blocked' && phase !== 'error') return;
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
    const result = await requestCall({ leadId: request.leadId, contactId: request.contactId ?? undefined, fromNumberId: request.fromNumberId });
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

  const dtmf = (digit: string) => callRef.current?.dtmf(digit);

  const chooseMic = (deviceId: string) => {
    setMicId(deviceId);
    if (deviceId && hasProviderCall(state)) void callRef.current?.setAudioInDevice?.(deviceId);
  };
  const chooseSpeaker = (deviceId: string) => {
    setSpeakerId(deviceId);
    if (deviceId && hasProviderCall(state)) void callRef.current?.setAudioOutDevice?.(deviceId);
  };

  /** Saves the wrap-up. Resolves with the saved outcome, or null when it did not save (the state shows why). */
  const saveOutcome = async (outcome: PhoneOutcomeId, notes: string): Promise<PhoneOutcomeId | null> => {
    if (state.phase !== 'wrap_up' || state.saving) return null;
    dispatch({ type: 'SAVE_STARTED' });
    const result = await saveCallOutcome({ callId: state.callId, outcome, notes });
    if (!result.ok) {
      dispatch({ type: 'SAVE_FAILED', message: result.error });
      return null;
    }
    dispatch({ type: 'SAVE_SUCCEEDED', outcome });
    return outcome;
  };

  /** Back to a fresh dialer after a blocked, failed or saved call. */
  const reset = useCallback(() => dispatch({ type: 'RESET' }), [dispatch]);
  /** Reopen the wrap-up of an earlier call that has no outcome. */
  const resume = useCallback((callId: string) => dispatch({ type: 'RESUME_WRAP_UP', callId }), [dispatch]);

  // Elapsed seconds for the ringing and connected timers: counted from when the phase began.
  const [phaseStart, setPhaseStart] = useState(() => Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const [talkSeconds, setTalkSeconds] = useState(0);
  const phaseName = state.phase;
  useEffect(() => {
    if (phaseName === 'wrap_up') {
      setTalkSeconds(stateRef.current.phase === 'wrap_up' && stateRef.current.answered ? Math.max(0, Math.round((Date.now() - phaseStart) / 1000)) : 0);
    }
    setPhaseStart(Date.now());
    setTick(Date.now());
    if (phaseName !== 'ringing' && phaseName !== 'in_call') return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- phaseStart is set here
  }, [phaseName]);
  const elapsed = Math.max(0, Math.round((tick - phaseStart) / 1000));

  // Ringback while it rings, unless the provider's early media is already playing it; a busy tone when busy.
  useEffect(() => {
    if (phaseName !== 'ringing') return;
    const earlyMedia = audioRef.current?.srcObject;
    if (earlyMedia) return;
    return playTone(RINGBACK);
  }, [phaseName]);
  const endKind = state.phase === 'wrap_up' ? state.end.kind : null;
  useEffect(() => {
    if (endKind !== 'busy') return;
    return playTone(BUSY);
  }, [endKind]);

  // The browser SDK does not always say why a call ended. While a call is live, ask the server what the
  // provider reported for it; a final status ends the softphone with the reason.
  const liveCallId = state.phase === 'connecting' || state.phase === 'ringing' || state.phase === 'in_call' ? state.callId : null;
  useEffect(() => {
    if (!liveCallId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const row = await fetchCallRow(liveCallId);
      if (cancelled || !row || !(FINAL_CALL_STATUSES as readonly string[]).includes(row.status)) return;
      dispatch({ type: 'REMOTE_ENDED', hangup: rawHangupFromRow(row) });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [liveCallId, dispatch]);

  return {
    rtc,
    state,
    stateRef,
    audioRef,
    devices,
    micId,
    speakerId,
    elapsed,
    talkSeconds,
    dial,
    hangup,
    toggleMute,
    toggleHold,
    dtmf,
    chooseMic,
    chooseSpeaker,
    saveOutcome,
    reset,
    resume,
  };
}
