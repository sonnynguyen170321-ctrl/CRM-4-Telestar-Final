/**
 * The mark we put on the leg we create ourselves.
 *
 * When the webhook connects a parked call it transfers it to the lead's number, and Telnyx reports
 * that new leg with its own `call.initiated`. The parked leg and our leg both arrive as
 * `call.initiated`, so the handler needs a way to tell "a rep's call waiting to be authorized" from
 * "the leg we just created". The transfer's `client_state` carries `leg:<callId>`.
 *
 * It is a hint, not a credential: the webhook only skips authorization after checking that the named
 * call exists and is already connected under the same provider session, and the worst a forged mark
 * can do is leave a parked call un-answered (which Telnyx drops) — it can never connect one.
 */

const PREFIX = 'leg:';

export function legClientState(callId: string): string {
  return Buffer.from(`${PREFIX}${callId}`, 'utf8').toString('base64');
}

/** The call id named by a leg mark, or null when `clientState` is anything else (a call token, nothing). */
export function legCallId(clientState: string | null | undefined): string | null {
  if (!clientState) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(clientState, 'base64').toString('utf8');
  } catch {
    return null;
  }
  if (!decoded.startsWith(PREFIX)) return null;
  const id = decoded.slice(PREFIX.length);
  return id.length > 0 && id.length <= 64 ? id : null;
}
