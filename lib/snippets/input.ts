import { z } from 'zod';
import { isHtmlBlank, sanitizeComposeHtml, unchipifyMergeTags } from '@/lib/compose/html';

export const snippetInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the snippet a name').max(80),
  bodyHtml: z.string().min(1, 'Snippet cannot be empty').max(20_000),
  isShared: z.boolean().optional(),
});

export const snippetPatchSchema = snippetInputSchema.partial();

/** The stored form: sanitised HTML with merge tags as plain text. Null when nothing visible is left. */
export function snippetBodyForStorage(raw: string): string | null {
  const clean = sanitizeComposeHtml(unchipifyMergeTags(raw));
  return isHtmlBlank(clean) ? null : clean;
}
