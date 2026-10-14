import { z } from 'zod';
import { composeHtmlShapeProblem, isHtmlBlank, sanitizeComposeHtml, unchipifyMergeTags } from '@/lib/compose/html';

export const snippetInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the snippet a name').max(80),
  bodyHtml: z
    .string()
    .min(1, 'Snippet cannot be empty')
    .max(20_000)
    // HTML too large or too deep for the sanitiser is refused here, with the reason, not as a 500.
    .superRefine((value, ctx) => {
      const problem = composeHtmlShapeProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
  isShared: z.boolean().optional(),
});

export const snippetPatchSchema = snippetInputSchema.partial();

/** The stored form: sanitised HTML with merge tags as plain text. Null when nothing visible is left. */
export function snippetBodyForStorage(raw: string): string | null {
  const clean = sanitizeComposeHtml(unchipifyMergeTags(raw));
  return isHtmlBlank(clean) ? null : clean;
}
