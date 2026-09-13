import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// `@aws-sdk/client-kms` is an OPTIONAL, server-only dependency that is only loaded
// when KMS_KEY_ARN is set (production AWS deployments). It is not installed in the
// default/local setup. Holding the specifier in a variable keeps the bundler from
// statically resolving it (which would emit a spurious "module not found" warning
// on every request); it is required lazily at runtime inside a try/catch instead.
const KMS_MODULE = '@aws-sdk/client-kms';

async function loadKms(): Promise<any> {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ KMS_MODULE);
}

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY env var must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * A stored credential could not be decrypted.
 *
 * This type exists because the underlying failure is anonymous. When `ENCRYPTION_KEY` is
 * present and the right length but is simply the *wrong key* — precisely the state a host
 * migration produces — AES-GCM's authentication check fails and Node throws
 * `Error: Unsupported state or unable to authenticate data`. That message matches nothing in
 * `classifySendFailure`, so it fell through to `ambiguous` and every affected message was
 * parked for a 24-hour reconciliation window. A condition that fails *every send in the
 * tenant, identically, forever* was being recorded as "this one might have gone out".
 *
 * Naming it makes it classifiable as a definite non-delivery, and puts the actual cause in the
 * `errorMessage` an operator reads instead of leaving them to infer it from the wording of a
 * crypto primitive.
 */
export class CredentialDecryptionError extends Error {
  override readonly name = 'CredentialDecryptionError';

  constructor(cause?: unknown) {
    super(
      'stored credential could not be decrypted — ENCRYPTION_KEY does not match the key this ' +
        'value was encrypted with, or the stored value is corrupt'
    );
    if (cause !== undefined) this.cause = cause;
  }
}

/** Encrypt a plaintext string. Returns a base64 string: iv + authTag + ciphertext (local) or kms:payload. */
export async function encrypt(plaintext: string): Promise<string> {
  const kmsKeyArn = process.env.KMS_KEY_ARN;

  if (kmsKeyArn) {
    try {
      const { KMSClient, GenerateDataKeyCommand } = await loadKms();
      const kms = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
      const kmsResponse = await kms.send(
        new GenerateDataKeyCommand({
          KeyId: kmsKeyArn,
          KeySpec: 'AES_256',
        })
      );

      const rawDEK = kmsResponse.Plaintext!;
      const encryptedDEK = kmsResponse.CiphertextBlob!;

      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, rawDEK, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      const payload = {
        dek: Buffer.from(encryptedDEK).toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: encrypted.toString('base64'),
      };

      return 'kms:' + Buffer.from(JSON.stringify(payload)).toString('base64');
    } catch (err) {
      console.error('[crypto] AWS KMS encryption failed, falling back to local encryption:', err);
    }
  }

  // Fallback / Local encryption
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Decrypt a base64 string produced by encrypt(). Returns plaintext. */
export async function decrypt(encoded: string): Promise<string> {
  if (encoded.startsWith('kms:')) {
    try {
      const rawPayload = Buffer.from(encoded.substring(4), 'base64').toString('utf8');
      const payload = JSON.parse(rawPayload);

      const { KMSClient, DecryptCommand } = await loadKms();
      const kms = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });

      const kmsResponse = await kms.send(
        new DecryptCommand({
          CiphertextBlob: Buffer.from(payload.dek, 'base64'),
        })
      );

      const rawDEK = kmsResponse.Plaintext!;
      const iv = Buffer.from(payload.iv, 'base64');
      const tag = Buffer.from(payload.tag, 'base64');
      const ciphertext = Buffer.from(payload.ciphertext, 'base64');

      const decipher = createDecipheriv(ALGORITHM, rawDEK, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (err) {
      console.error('[crypto] AWS KMS decryption failed, trying local decryption fallback:', err);
    }
  }

  // Local / Fallback decryption
  //
  // getKey() stays outside the try: a missing or wrong-length ENCRYPTION_KEY already throws a
  // message that names the variable and the required format, and rewriting it as "could not be
  // decrypted" would lose that. Only the cryptographic step below is re-labelled, because that
  // is the step whose native error says nothing about what went wrong.
  const key = getKey();
  try {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new CredentialDecryptionError(err);
  }
}

