/**
 * The telephony provider seam (docs/dialer/TECH.md).
 *
 * Everything the CRM asks of a carrier goes through this interface, so the call logic, the
 * compliance gate and the webhook inbox stay the same if a Vietnam-licensed trunk is ever added
 * behind it. `lib/telephony/telnyx/` is the implementation; `lib/telephony/fake.ts` is the one tests
 * use.
 */

export type ProviderCredential = {
  /** The provider's id for the credential (Telnyx `telephony_credentials.id`). */
  providerCredentialId: string;
  /** The SIP user the browser registers as (`gencred…` on Telnyx). */
  sipUsername: string;
};

export type ProviderToken = {
  token: string;
  expiresAt: Date;
};

export type ProviderBalance = {
  /** Spendable now: balance plus credit, minus pending charges. */
  availableCredit: number;
  currency: string;
};

/** The call-control actions the CRM issues. Each carries an idempotency key. */
export type CallCommand =
  | { action: 'answer' }
  | { action: 'hangup' }
  | { action: 'transfer'; to: string; from?: string; timeoutSecs?: number; clientState?: string }
  | { action: 'record_start'; channels?: 'single' | 'dual'; playBeep?: boolean }
  /** Text-to-speech on a leg; used for the recording notice. */
  | { action: 'speak'; payload: string };

export interface TelephonyProvider {
  readonly name: string;
  /**
   * The live credential with exactly this name, if one exists. Lets a rep's credential be adopted
   * when an earlier create succeeded at the provider but its answer never reached us.
   */
  findCredentialByName(name: string): Promise<ProviderCredential | null>;
  /** Create the rep's softphone credential at the provider. Not retried: a retry could create two. */
  createCredential(input: { label: string; tag: string }): Promise<ProviderCredential>;
  /** Remove a credential at the provider; succeeding when it is already gone. */
  revokeCredential(providerCredentialId: string): Promise<void>;
  /** A short-lived login token for the browser SDK. The credential's password never leaves the provider. */
  mintToken(providerCredentialId: string): Promise<ProviderToken>;
  /** Issue a call-control command. `commandId` makes a retried command a no-op at the provider. */
  command(callControlId: string, command: CallCommand, commandId: string): Promise<void>;
  /** A fresh, short-lived download URL for a recording. */
  getRecordingUrl(recordingId: string): Promise<string | null>;
  /** Delete a recording; succeeding when it is already gone. */
  deleteRecording(recordingId: string): Promise<void>;
  getBalance(): Promise<ProviderBalance>;
  /**
   * Whether the provider still has this call leg up. What the reconcile cron asks about a call that
   * no webhook has finished: "not alive" means it is over (the cause and duration are not known).
   */
  getCallStatus(callControlId: string): Promise<ProviderCallStatus>;
}

export type ProviderCallStatus = { alive: boolean };

/** A provider call that failed, with the provider's status so callers can tell "gone" from "broken". */
export class TelephonyProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'TelephonyProviderError';
  }
}
