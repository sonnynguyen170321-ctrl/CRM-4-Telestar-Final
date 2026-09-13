import { describe, it, expect, afterEach } from 'vitest';
import { encrypt, decrypt } from '@/lib/crypto';

describe('P1.9 Token Encryption — encrypt/decrypt round-trip', () => {
  it('encrypts and decrypts an access token', async () => {
    const token = 'ya29.a0AfH6SMDummyToken123456789';
    const encrypted = await encrypt(token);
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(token);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(token);
  });

  it('encrypts and decrypts a refresh token', async () => {
    const token = '1//0gDummyRefreshToken987654321';
    const encrypted = await encrypt(token);
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(token);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(token);
  });

  it('produces different ciphertexts for the same plaintext (IV uniqueness)', async () => {
    const token = 'ya29-same-token-every-time';
    const [a, b] = await Promise.all([encrypt(token), encrypt(token)]);
    expect(a).not.toBe(b);
  });

  it('handles empty string', async () => {
    const encrypted = await encrypt('');
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe('');
  });
});

/**
 * Decryption failure has to name its own cause.
 *
 * With `ENCRYPTION_KEY` present and 64 hex characters but simply *wrong* — the exact state a
 * host migration produces — Node throws `Unsupported state or unable to authenticate data`.
 * Nothing in that sentence points at the key, so the failure classifier could not act on it and
 * an operator reading the stored `errorMessage` learned nothing. See workers/email.ts.
 */
describe('decrypt — a wrong key is diagnosable', () => {
  const REAL_KEY = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    if (REAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = REAL_KEY;
  });

  it('throws CredentialDecryptionError when the key does not match', async () => {
    const { CredentialDecryptionError } = await import('@/lib/crypto');
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    const ciphertext = await encrypt('ya29.token-encrypted-under-key-a');

    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    await expect(decrypt(ciphertext)).rejects.toBeInstanceOf(CredentialDecryptionError);
    await expect(decrypt(ciphertext)).rejects.toThrow(/ENCRYPTION_KEY does not match/);
  });

  it('throws CredentialDecryptionError on a corrupt stored value', async () => {
    const { CredentialDecryptionError } = await import('@/lib/crypto');
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    await expect(decrypt('bm90LWEtcmVhbC1jaXBoZXJ0ZXh0')).rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  it('keeps the distinct message for a missing or malformed key', async () => {
    // "ENCRYPTION_KEY is absent" already says what to do; rewriting it as "could not be
    // decrypted" would replace a precise instruction with a vaguer one.
    process.env.ENCRYPTION_KEY = 'too-short';
    await expect(decrypt('anything')).rejects.toThrow(/64-character hex string/);
  });
});
