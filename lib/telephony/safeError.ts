/**
 * What may be logged about an error on the dialer's hot paths: its class and code, never its message.
 * Prisma and fetch messages can carry the query arguments or the request body, which here would be a
 * phone number, a call token or a webhook payload.
 */
export function safeError(error: unknown): { name: string; code?: string | number; status?: number; providerCode?: string; providerTitle?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const status = (error as { status?: unknown }).status;
    const provider = (error as { providerError?: { code?: unknown; title?: unknown } | null }).providerError;
    return {
      name: error.name,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      ...(typeof status === 'number' ? { status } : {}),
      ...(typeof provider?.code === 'string' ? { providerCode: provider.code } : {}),
      ...(typeof provider?.title === 'string' ? { providerTitle: provider.title } : {}),
    };
  }
  return { name: typeof error };
}
