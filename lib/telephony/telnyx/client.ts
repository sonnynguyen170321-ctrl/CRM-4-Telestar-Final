import 'server-only';

import {
  TelephonyProviderError,
  type CallCommand,
  type ProviderBalance,
  type ProviderCallStatus,
  type ProviderCredential,
  type ProviderToken,
  type TelephonyProvider,
} from '../provider';

/**
 * Telnyx REST client (https://developers.telnyx.com/api).
 *
 * Plain fetch: a timeout on every request, retries only for responses Telnyx itself says may
 * succeed later (429 and 5xx, honouring `retry-after`), and `command_id` on call-control commands so
 * a retried command is a no-op at Telnyx. The API key never leaves this module.
 */

const API_BASE = 'https://api.telnyx.com/v2';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
/** A `retry-after` longer than this is not waited out inside a user's request. */
const MAX_RETRY_AFTER_SECONDS = 5;
/** Telnyx WebRTC login tokens live 24 hours. */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

type FetchLike = typeof fetch;

/** Telnyx serves recording downloads from its own domain and from the S3 bucket behind it. */
export const DEFAULT_RECORDING_HOST_SUFFIXES = ['telnyx.com', 's3.amazonaws.com', 'amazonaws.com'] as const;

/** True for an https URL whose host is one of the suffixes or a subdomain of one. */
export function isTrustedRecordingUrl(url: string, extraSuffixes: readonly string[] = []): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return [...DEFAULT_RECORDING_HOST_SUFFIXES, ...extraSuffixes].some((suffix) => {
    const s = suffix.trim().toLowerCase().replace(/^\./, '');
    return s.length > 0 && (host === s || host.endsWith(`.${s}`));
  });
}

export type TelnyxConfig = {
  apiKey: string;
  credentialConnectionId: string;
  /** Extra host suffixes recordings may be downloaded from, on top of `DEFAULT_RECORDING_HOST_SUFFIXES`. */
  recordingHosts?: string[];
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

const COMMAND_PATH: Record<CallCommand['action'], string> = {
  answer: 'answer',
  hangup: 'hangup',
  transfer: 'transfer',
  record_start: 'record_start',
  speak: 'speak',
};

function commandBody(command: CallCommand, commandId: string): Record<string, unknown> {
  switch (command.action) {
    case 'transfer':
      return {
        command_id: commandId,
        to: command.to,
        ...(command.from ? { from: command.from } : {}),
        ...(command.timeoutSecs ? { timeout_secs: command.timeoutSecs } : {}),
        ...(command.clientState ? { client_state: command.clientState } : {}),
      };
    case 'record_start':
      return {
        command_id: commandId,
        format: 'mp3',
        channels: command.channels ?? 'dual',
        play_beep: command.playBeep ?? false,
      };
    case 'speak':
      return { command_id: commandId, payload: command.payload, payload_type: 'text', voice: 'female', language: 'en-US' };
    default:
      return { command_id: commandId };
  }
}

type TelnyxReply = { status: number; text: string };

function parseJson<T>(reply: TelnyxReply): T {
  try {
    return JSON.parse(reply.text) as T;
  } catch {
    throw new TelephonyProviderError('Telnyx answered with a body that is not JSON', reply.status, false);
  }
}

export class TelnyxProvider implements TelephonyProvider {
  readonly name = 'telnyx';
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: TelnyxConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * One request, retried on 429/5xx/network errors only, up to `attempts`. The body is read inside
   * the same timeout as the headers, so a stalled body cannot hold a user's request open. Answers
   * 2xx, and 404 when `allowNotFound` is set so deletes can treat "already gone" as done.
   */
  private async request(
    method: string,
    path: string,
    body?: unknown,
    options: { allowNotFound?: boolean; attempts?: number } = {}
  ): Promise<TelnyxReply> {
    const attempts = options.attempts ?? MAX_ATTEMPTS;
    let lastError: TelephonyProviderError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(`${API_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            Accept: 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.ok || (options.allowNotFound && response.status === 404)) {
          return { status: response.status, text: await response.text() };
        }

        const retryable = response.status === 429 || response.status >= 500;
        // Never echo the response body into the error: it can carry the request back.
        lastError = new TelephonyProviderError(`Telnyx ${method} ${path} failed with ${response.status}`, response.status, retryable);
        // Release the socket: an unread error body keeps it busy through a 429/5xx storm.
        // A cancel can only fail on a stream that is already closed, which is the goal anyway.
        await response.body?.cancel().catch(() => undefined);
        if (!retryable) throw lastError;
        if (attempt < attempts) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000 : 250 * attempt);
        }
      } catch (error) {
        if (error instanceof TelephonyProviderError && !error.retryable) throw error;
        if (!(error instanceof TelephonyProviderError)) {
          lastError = new TelephonyProviderError(`Telnyx ${method} ${path} did not answer`, null, true);
          if (attempt < attempts) await this.sleep(250 * attempt);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new TelephonyProviderError(`Telnyx ${method} ${path} failed`, null, true);
  }

  async findCredentialByName(name: string): Promise<ProviderCredential | null> {
    const query = new URLSearchParams({ 'filter[name]': name, 'page[size]': '20' });
    const reply = await this.request('GET', `/telephony_credentials?${query}`);
    const json = parseJson<{ data?: Array<{ id?: string; name?: string; sip_username?: string; expired?: boolean }> }>(reply);
    // Match the name ourselves: if the filter were ever ignored, the list would hold other reps'
    // credentials, and adopting one would put two reps on one phone line.
    const match = (json.data ?? []).find((c) => c.name === name && c.id && c.sip_username && c.expired !== true);
    return match ? { providerCredentialId: match.id!, sipUsername: match.sip_username! } : null;
  }

  async createCredential(input: { label: string; tag: string }): Promise<ProviderCredential> {
    // One attempt: if the answer is lost after Telnyx created it, a retry would make a second
    // credential. The next request adopts the first one by name instead (findCredentialByName).
    const reply = await this.request(
      'POST',
      '/telephony_credentials',
      { connection_id: this.config.credentialConnectionId, name: input.label, tag: input.tag },
      { attempts: 1 }
    );
    const json = parseJson<{ data?: { id?: string; sip_username?: string } }>(reply);
    if (!json.data?.id || !json.data.sip_username) {
      throw new TelephonyProviderError('Telnyx created a credential without an id or SIP user', reply.status, false);
    }
    return { providerCredentialId: json.data.id, sipUsername: json.data.sip_username };
  }

  async revokeCredential(providerCredentialId: string): Promise<void> {
    await this.request('DELETE', `/telephony_credentials/${encodeURIComponent(providerCredentialId)}`, undefined, {
      allowNotFound: true,
    });
  }

  async mintToken(providerCredentialId: string): Promise<ProviderToken> {
    const reply = await this.request('POST', `/telephony_credentials/${encodeURIComponent(providerCredentialId)}/token`);
    const token = reply.text.trim();
    if (!token) throw new TelephonyProviderError('Telnyx returned an empty token', reply.status, false);
    return { token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) };
  }

  async command(callControlId: string, command: CallCommand, commandId: string): Promise<void> {
    await this.request(
      'POST',
      `/calls/${encodeURIComponent(callControlId)}/actions/${COMMAND_PATH[command.action]}`,
      commandBody(command, commandId)
    );
  }

  isRecordingUrlTrusted(url: string): boolean {
    return isTrustedRecordingUrl(url, this.config.recordingHosts ?? []);
  }

  async getRecordingUrl(recordingId: string): Promise<string | null> {
    const reply = await this.request('GET', `/recordings/${encodeURIComponent(recordingId)}`, undefined, { allowNotFound: true });
    if (reply.status === 404) return null;
    const json = parseJson<{ data?: { download_urls?: { mp3?: string; wav?: string } } }>(reply);
    return json.data?.download_urls?.mp3 ?? json.data?.download_urls?.wav ?? null;
  }

  async deleteRecording(recordingId: string): Promise<void> {
    await this.request('DELETE', `/recordings/${encodeURIComponent(recordingId)}`, undefined, { allowNotFound: true });
  }

  async getCallStatus(callControlId: string): Promise<ProviderCallStatus> {
    try {
      const reply = await this.request('GET', `/calls/${encodeURIComponent(callControlId)}`, undefined, { allowNotFound: true });
      if (reply.status === 404) return { alive: false };
      const json = parseJson<{ data?: { is_alive?: boolean } }>(reply);
      return { alive: json.data?.is_alive === true };
    } catch (error) {
      // Telnyx answers 422 (90018) for a leg that has already ended.
      if (error instanceof TelephonyProviderError && error.status === 422) return { alive: false };
      throw error;
    }
  }

  async getBalance(): Promise<ProviderBalance> {
    const reply = await this.request('GET', '/balance');
    const json = parseJson<{ data?: { available_credit?: string | number; currency?: string } }>(reply);
    const availableCredit = Number(json.data?.available_credit);
    if (!Number.isFinite(availableCredit)) {
      throw new TelephonyProviderError('Telnyx balance had no available_credit', reply.status, false);
    }
    return { availableCredit, currency: json.data?.currency ?? 'USD' };
  }
}
