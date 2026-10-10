/**
 * Reading a Telnyx call-control webhook (https://developers.telnyx.com/docs/voice/programmable-voice/receiving-webhooks).
 *
 * The envelope is `{ data: { id, event_type, occurred_at, payload: { … } }, meta }`. Everything here is
 * read defensively: the body arrived over the network and, though its signature has been checked, a
 * field may be missing or of another type, and an event we do not understand must still be stored.
 * Nothing in this file decides anything; it only names the fields.
 */

export type TelnyxLegDirection = 'incoming' | 'outgoing';

export type TelnyxEvent = {
  /** `data.id` — the same on every redelivery. */
  providerEventId: string;
  /** `data.event_type`, e.g. `call.initiated`. */
  type: string;
  occurredAt: Date | null;
  /** `call_session_id` — shared by every leg of a call. */
  sessionId: string | null;
  /** `call_control_id` — the leg this event is about, and the id commands are sent to. */
  controlId: string | null;
  direction: TelnyxLegDirection | null;
  /** `client_state`, base64 as Telnyx carries it. */
  clientState: string | null;
  from: string | null;
  to: string | null;
  hangupCause: string | null;
  startTime: Date | null;
  endTime: Date | null;
  recordingId: string | null;
};

const MAX_FIELD_LENGTH = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH ? value : null;
}

function time(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The event, or null when the body is not a call-control envelope with an id and a type. */
export function parseTelnyxEvent(body: unknown): TelnyxEvent | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const data = body.data;
  const providerEventId = text(data.id);
  const type = text(data.event_type);
  if (!providerEventId || !type) return null;

  const payload = isRecord(data.payload) ? data.payload : {};
  const direction = payload.direction === 'incoming' || payload.direction === 'outgoing' ? payload.direction : null;
  return {
    providerEventId,
    type,
    occurredAt: time(data.occurred_at),
    sessionId: text(payload.call_session_id),
    controlId: text(payload.call_control_id),
    direction,
    clientState: text(payload.client_state),
    from: text(payload.from),
    to: text(payload.to),
    hangupCause: text(payload.hangup_cause),
    startTime: time(payload.start_time),
    endTime: time(payload.end_time),
    recordingId: text(payload.recording_id),
  };
}
