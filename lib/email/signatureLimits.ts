/** Shared by the server (lib/email/signature.ts) and the editor, which checks before uploading. */
export const SIGNATURE_LIMITS = {
  maxHtmlChars: 50_000,
  maxImages: 5,
  maxImageBytes: 300_000,
} as const;

/**
 * The longest signature the editor may send: the HTML limit plus every image at its cap,
 * base64-encoded (4 characters per 3 bytes), plus room for the data-URI prefixes. Derived, so
 * raising an image limit cannot leave this bound refusing images the limits allow.
 */
export const SIGNATURE_MAX_INPUT_CHARS =
  SIGNATURE_LIMITS.maxHtmlChars +
  Math.ceil((SIGNATURE_LIMITS.maxImages * SIGNATURE_LIMITS.maxImageBytes * 4) / 3) +
  1_000;

export const SIGNATURE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
