import type { SendEmailOptions } from '@/lib/email/EmailService';

/**
 * The CC / BCC part of a nodemailer message, shared by the three adapters.
 *
 * SMTP gets the blind recipients through the envelope and must not carry the header, so for it
 * `copyRecipientFields` is all that is needed. Gmail (`messages.send`) and Graph (`sendMail` with a
 * MIME body) take the finished MIME and read the recipients out of its headers: nodemailer drops the
 * Bcc header from built MIME by default, which would silently send to nobody in BCC. Those two build
 * through `buildRawMime`, which keeps it; both providers remove the Bcc header from the copies they
 * deliver.
 */
export function copyRecipientFields(options: Pick<SendEmailOptions, 'cc' | 'bcc'>): { cc?: string[]; bcc?: string[] } {
  const cc = options.cc?.length ? options.cc : undefined;
  const bcc = options.bcc?.length ? options.bcc : undefined;
  return { ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}) };
}

/** Build the MIME of a composed message, keeping the Bcc header when there is a blind recipient. */
export async function buildRawMime(
  mail: { compile(): { keepBcc?: boolean; build(): Promise<Buffer> } },
  options: Pick<SendEmailOptions, 'bcc'>,
): Promise<Buffer> {
  const node = mail.compile();
  if (options.bcc?.length) node.keepBcc = true;
  return node.build();
}
