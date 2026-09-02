import "server-only";

import { encryptSenderAuth } from "../credentials/credentialLoader";

// OL4: create a sender account. Credentials are encrypted (AES-256-GCM, B1)
// BEFORE they touch the database — the plaintext {user, pass} never lands in a
// column, a log, or a read model (Invariant 9). A new sender always starts
// liveSendEnabled = false: it cannot send a real email until it is verified +
// warmed and explicitly flipped at the OL7 cutover. Fail-closed: encryptSenderAuth
// throws if the master key is absent, so a misconfigured env cannot store secrets.

export type CreateSenderInput = {
  organizationId: string;
  createdByUserId?: string | null;
  kind: "RELAY" | "MAILBOX";
  displayName: string;
  fromAddress: string;
  fromName?: string | null;
  domain: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean | null;
  imapUser?: string | null;
  imapPass?: string | null;
  returnPathAddress?: string | null;
  dailyCapTarget?: number;
};

export type CreateSenderDb = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type CreateSenderResult = { id: string };

export function validateCreateSenderInput(input: CreateSenderInput): string | null {
  if (!input.displayName.trim()) return "Display name is required.";
  if (!isEmail(input.fromAddress)) return "A valid from address is required.";
  if (!input.domain.trim()) return "Sending domain is required.";
  if (!input.smtpHost.trim()) return "SMTP host is required.";
  if (!Number.isInteger(input.smtpPort) || input.smtpPort <= 0) return "SMTP port must be a positive integer.";
  if (!input.smtpUser.trim() || !input.smtpPass) return "SMTP credentials are required.";
  if (input.imapHost && (!input.imapUser || !input.imapPass)) return "IMAP host requires IMAP credentials.";
  return null;
}

export async function createSender(
  db: CreateSenderDb,
  input: CreateSenderInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<CreateSenderResult> {
  const invalid = validateCreateSenderInput(input);
  if (invalid) {
    throw new Error(invalid);
  }

  // Encrypt first — fail closed before any DB write if the master key is missing.
  const smtpAuthEnc = encryptSenderAuth({ user: input.smtpUser, pass: input.smtpPass }, env);
  const imapAuthEnc =
    input.imapHost && input.imapUser && input.imapPass
      ? encryptSenderAuth({ user: input.imapUser, pass: input.imapPass }, env)
      : null;

  const id = `snd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  await db.$executeRawUnsafe(
    `INSERT INTO "V2SenderAccount"
       ("id", "organizationId", "kind", "displayName", "fromAddress", "fromName", "domain",
        "smtpHost", "smtpPort", "smtpSecure", "smtpAuthEnc",
        "imapHost", "imapPort", "imapSecure", "imapAuthEnc", "returnPathAddress",
        "dailyCapTarget", "status", "liveSendEnabled", "createdByUserId", "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3::"V2SenderKind", $4, $5, $6, $7,
        $8, $9, $10, $11::jsonb,
        $12, $13, $14, $15::jsonb, $16,
        $17, 'ACTIVE', false, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    id,
    input.organizationId,
    input.kind,
    input.displayName.trim(),
    input.fromAddress.trim().toLowerCase(),
    input.fromName?.trim() || null,
    input.domain.trim().toLowerCase(),
    input.smtpHost.trim(),
    input.smtpPort,
    input.smtpSecure,
    JSON.stringify(smtpAuthEnc),
    input.imapHost?.trim() || null,
    input.imapPort ?? null,
    input.imapSecure ?? null,
    imapAuthEnc ? JSON.stringify(imapAuthEnc) : null,
    input.returnPathAddress?.trim()?.toLowerCase() || null,
    Number.isInteger(input.dailyCapTarget) ? input.dailyCapTarget : 0,
    input.createdByUserId ?? null
  );

  return { id };
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
