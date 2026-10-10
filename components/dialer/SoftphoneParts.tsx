'use client';

import { useState } from 'react';
import { Mic, MicOff, Pause, Play, PhoneOff } from 'lucide-react';

import { blockLabel } from '@/lib/telephony/blockLabels';
import { NOTES_MAX, PHONE_OUTCOMES, type PhoneOutcomeId } from '@/lib/telephony/outcomes';

/** The smaller pieces of the softphone dialog; the state lives in Softphone.tsx. */

const GROUPS = ['No contact', 'Connected', 'Follow-up'] as const;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const;

const buttonBase = 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border font-semibold transition-colors';
const neutralButton = `${buttonBase} border-card-border text-text-secondary hover:text-text-primary hover:bg-card-border/30`;

export function BlockedReasons({ reasons, dryRun, localTime, timezone }: { reasons: string[]; dryRun: boolean; localTime: string | null; timezone: string | null }) {
  return (
    <div role="alert" className="rounded-xl border border-brand-orange-text/30 bg-brand-orange-text/10 p-3 space-y-2">
      <p className="font-semibold text-brand-orange-text">{dryRun ? 'No call was placed (test mode).' : 'This call cannot be placed.'}</p>
      <ul className="space-y-1.5">
        {reasons.map((reason) => {
          const { label, fix } = blockLabel(reason);
          return (
            <li key={reason} className="leading-relaxed text-text-primary">
              {label}
              {fix && <span className="block text-text-secondary">{fix}</span>}
            </li>
          );
        })}
      </ul>
      {localTime && (
        <p className="type-meta text-text-muted">
          Local time for the lead: {localTime}
          {timezone ? ` (${timezone})` : ''}
        </p>
      )}
    </div>
  );
}

export function CallControls(props: {
  muted: boolean;
  held: boolean;
  onMute: () => void;
  onHold: () => void;
  onDtmf: (digit: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [showKeypad, setShowKeypad] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={props.onMute} aria-pressed={props.muted} className={neutralButton}>
          {props.muted ? <MicOff className="w-3.5 h-3.5" aria-hidden="true" /> : <Mic className="w-3.5 h-3.5" aria-hidden="true" />}
          {props.muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" onClick={props.onHold} aria-pressed={props.held} className={neutralButton}>
          {props.held ? <Play className="w-3.5 h-3.5" aria-hidden="true" /> : <Pause className="w-3.5 h-3.5" aria-hidden="true" />}
          {props.held ? 'Resume' : 'Hold'}
        </button>
        <button type="button" onClick={() => setShowKeypad((open) => !open)} aria-expanded={showKeypad} className={neutralButton}>
          Keypad
        </button>
      </div>
      {showKeypad && (
        <div className="space-y-1.5">
          <output aria-label="Digits sent" className="block h-5 font-mono text-text-primary tracking-widest">
            {typed}
          </output>
          <div className="grid grid-cols-3 gap-1.5 w-44">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  props.onDtmf(key);
                  setTyped((value) => (value + key).slice(-16));
                }}
                className="py-2 rounded-lg border border-card-border bg-bg-main font-mono text-text-primary hover:border-brand-red/30"
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export type DeviceOption = { deviceId: string; label: string };

export function DevicePicker(props: {
  inputs: DeviceOption[];
  outputs: DeviceOption[];
  micId: string;
  speakerId: string;
  onMic: (deviceId: string) => void;
  onSpeaker: (deviceId: string) => void;
}) {
  if (props.inputs.length === 0 && props.outputs.length === 0) return null;
  const select = 'w-full bg-bg-main border border-card-border rounded-lg p-1.5 text-text-primary';
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1">
        <span className="text-xs font-bold text-text-secondary">Microphone</span>
        <select className={select} value={props.micId} onChange={(e) => props.onMic(e.target.value)}>
          <option value="">Default</option>
          {props.inputs.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>
              {device.label || `Microphone ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      {props.outputs.length > 0 && (
        <label className="space-y-1">
          <span className="text-xs font-bold text-text-secondary">Speaker</span>
          <select className={select} value={props.speakerId} onChange={(e) => props.onSpeaker(e.target.value)}>
            <option value="">Default</option>
            {props.outputs.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {device.label || `Speaker ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function OutcomeForm(props: {
  saving: boolean;
  error: string | null;
  endedNote: string;
  onSubmit: (outcome: PhoneOutcomeId, notes: string) => void;
}) {
  const [outcome, setOutcome] = useState<PhoneOutcomeId | null>(null);
  const [notes, setNotes] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-text-secondary">{props.endedNote} Say what happened to finish.</p>
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
      {props.error && (
        <p role="alert" className="text-brand-red font-semibold">
          {props.error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!outcome || props.saving}
          onClick={() => outcome && props.onSubmit(outcome, notes)}
          className="px-3 py-1.5 rounded-lg bg-brand-red text-white font-semibold disabled:opacity-50"
        >
          {props.saving ? 'Saving…' : 'Save outcome'}
        </button>
      </div>
    </div>
  );
}

export function HangupButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`${buttonBase} border-brand-red bg-brand-red text-white`}>
      <PhoneOff className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
