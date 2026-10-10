/**
 * What may be logged about an error on the dialer's hot paths: its class and code, never its message.
 * Prisma and fetch messages can carry the query arguments or the request body, which here would be a
 * phone number, a call token or a webhook payload.
 */
export function safeError(error: unknown): { name: string; code?: string | number } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { name: error.name, ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}) };
  }
  return { name: typeof error };
}
