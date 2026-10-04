import {
  TelephonyProviderError,
  type CallCommand,
  type ProviderBalance,
  type ProviderCredential,
  type ProviderToken,
  type TelephonyProvider,
} from './provider';

/**
 * In-memory provider for tests. Records every call made to it, and can be told to fail, so a test
 * asserts behaviour against the provider contract rather than against Telnyx's wire format.
 */
export class FakeTelephonyProvider implements TelephonyProvider {
  readonly name = 'fake';
  credentials = new Map<string, ProviderCredential & { label: string; tag: string }>();
  tokensMinted: string[] = [];
  commands: Array<{ callControlId: string; command: CallCommand; commandId: string }> = [];
  deletedRecordings: string[] = [];
  balance: ProviderBalance = { availableCredit: 100, currency: 'USD' };
  /** Set to make the next matching operation throw. */
  failNext: Partial<Record<'createCredential' | 'mintToken' | 'command' | 'getBalance', TelephonyProviderError>> = {};
  private sequence = 0;

  private maybeFail(operation: keyof FakeTelephonyProvider['failNext']) {
    const error = this.failNext[operation];
    if (error) {
      delete this.failNext[operation];
      throw error;
    }
  }

  /** Every create the CRM asked for, including ones later revoked. */
  credentialsCreated = 0;

  async findCredentialByName(name: string): Promise<ProviderCredential | null> {
    const match = [...this.credentials.values()].find((c) => c.label === name);
    return match ? { providerCredentialId: match.providerCredentialId, sipUsername: match.sipUsername } : null;
  }

  async createCredential(input: { label: string; tag: string }): Promise<ProviderCredential> {
    this.maybeFail('createCredential');
    this.credentialsCreated += 1;
    this.sequence += 1;
    const credential = { providerCredentialId: `fake-cred-${this.sequence}`, sipUsername: `gencred${this.sequence}`, ...input };
    this.credentials.set(credential.providerCredentialId, credential);
    return { providerCredentialId: credential.providerCredentialId, sipUsername: credential.sipUsername };
  }

  async revokeCredential(providerCredentialId: string): Promise<void> {
    this.credentials.delete(providerCredentialId);
  }

  async mintToken(providerCredentialId: string): Promise<ProviderToken> {
    this.maybeFail('mintToken');
    if (!this.credentials.has(providerCredentialId)) throw new TelephonyProviderError('unknown credential', 404, false);
    this.tokensMinted.push(providerCredentialId);
    return { token: `fake-jwt-${providerCredentialId}-${this.tokensMinted.length}`, expiresAt: new Date(Date.now() + 86_400_000) };
  }

  async command(callControlId: string, command: CallCommand, commandId: string): Promise<void> {
    this.maybeFail('command');
    this.commands.push({ callControlId, command, commandId });
  }

  async getRecordingUrl(recordingId: string): Promise<string | null> {
    return this.deletedRecordings.includes(recordingId) ? null : `https://recordings.example/${recordingId}.mp3`;
  }

  async deleteRecording(recordingId: string): Promise<void> {
    this.deletedRecordings.push(recordingId);
  }

  async getBalance(): Promise<ProviderBalance> {
    this.maybeFail('getBalance');
    return this.balance;
  }
}
