import { NextRequest, NextResponse } from 'next/server';

import { requireAuth, type SessionUser } from '@/lib/auth';
import { consumeAttempt } from '@/lib/security/attemptLimit';
import { generateStructured } from '@/lib/ai/generation';
import {
  buildRewritePrompt,
  parseRewriteOutput,
  REWRITE_ATTEMPT_TIMEOUT_MS,
  REWRITE_DEADLINE_MS,
  REWRITE_SYSTEM_PROMPT,
  rewriteRequestSchema,
  withDeadline,
} from '@/lib/ai/composeRewrite';
import { htmlToPlainText, plainTextToHtml, unchipifyMergeTags } from '@/lib/compose/html';
import { MAX_REWRITE_TEXT_CHARS, protectTokens, rewriteInputProblem, sameTemplateTokens, validateRewrite } from '@/lib/compose/rewrite';
import { isHtml } from '@/lib/email/sanitize';

export const dynamic = 'force-dynamic';

/**
 * AI on the draft: rewrite the composer's body (shorten, friendlier, more formal, fix grammar,
 * translate EN/VI, or the rep's own instruction) and hand it back for the rep to review.
 *
 * Nothing is stored and nothing is sent: the answer goes to a preview where the rep replaces,
 * inserts or discards it. No CRM record is read either, so there is no object to authorize; the
 * boundary is the session (an API key is refused: this is a composer feature, and a key would be a
 * metered rewrite endpoint for scripts), a per-rep and a per-tenant limit that both fail closed, and
 * input caps. The subject is never sent or changed.
 *
 * Template tokens never reach the model (lib/compose/rewrite.ts) and an answer that lost, repeated
 * or invented one, or carries a new link, is refused with a 422. The HTML that comes back passes
 * the same sanitiser as every composed body before the send routes queue it.
 *
 * The body is never logged, not even on failure.
 */
const LIMIT_BUCKET = 'ai_compose_rewrite';
const LIMIT_PER_WINDOW = 60;
const LIMIT_WINDOW_SECONDS = 10 * 60;
const TENANT_LIMIT_BUCKET = 'ai_compose_rewrite_tenant';
const TENANT_LIMIT_PER_HOUR = 1000;
const TENANT_LIMIT_WINDOW_SECONDS = 60 * 60;
const MAX_OUTPUT_TOKENS = 4000;

async function limit(userId: string, tenantId: string): Promise<NextResponse | null> {
  const attempt = await consumeAttempt({
    bucket: LIMIT_BUCKET, subject: userId, limit: LIMIT_PER_WINDOW, windowSeconds: LIMIT_WINDOW_SECONDS, failClosed: true,
  });
  const tenantAttempt = attempt.allowed
    ? await consumeAttempt({
        bucket: TENANT_LIMIT_BUCKET, subject: tenantId, limit: TENANT_LIMIT_PER_HOUR, windowSeconds: TENANT_LIMIT_WINDOW_SECONDS, failClosed: true,
      })
    : attempt;
  if (attempt.allowed && tenantAttempt.allowed) return null;
  return NextResponse.json(
    { success: false, error: 'Too many AI rewrites in a short time. Try again in a few minutes.' },
    { status: 429, headers: { 'Retry-After': String((!attempt.allowed ? attempt : tenantAttempt).retryAfterSeconds) } },
  );
}

const refused = (status: number, reason: string, message: string) => NextResponse.json({ success: false, reason, message, error: message }, { status });

/** The model's answer in the draft's own form: HTML sanitised, plain text kept plain. */
function toDraftForm(output: string, draftIsHtml: boolean): string {
  if (draftIsHtml) return isHtml(output) ? output : plainTextToHtml(output);
  return isHtml(output) ? htmlToPlainText(output) : output.replace(/\r\n/g, '\n').trim();
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  if (user.apiKey) return NextResponse.json({ error: 'Forbidden: AI rewrite is available in the composer only' }, { status: 403 });

  // Counted before anything in the body is parsed: a flood of large drafts is refused at the
  // counter, not after the scans that measure it.
  const limited = await limit(user.id, user.tenantId);
  if (limited) return limited;

  const parsed = rewriteRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  const { action, instruction } = parsed.data;
  const problem = rewriteInputProblem(parsed.data.body);
  if (problem) return refused(413, 'too_complex', problem);
  const body = unchipifyMergeTags(parsed.data.body);
  const draftIsHtml = isHtml(body);

  const protectedDraft = protectTokens(body);
  if (protectedDraft.masked.length > MAX_REWRITE_TEXT_CHARS) {
    return refused(413, 'too_long', 'This draft is too long to rewrite in one go. Shorten it, or rewrite it in parts.');
  }

  try {
    const outcome = await withDeadline(generateStructured<string>(
      {
        tenantId: user.tenantId,
        userId: user.id,
        operation: 'compose_rewrite',
        systemPrompt: REWRITE_SYSTEM_PROMPT,
        userPrompt: buildRewritePrompt({ action, masked: protectedDraft.masked, isHtml: draftIsHtml, instruction }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        timeoutMs: REWRITE_ATTEMPT_TIMEOUT_MS,
      },
      parseRewriteOutput,
    ), REWRITE_DEADLINE_MS);
    if (outcome.timedOut) {
      return refused(504, 'timeout', 'The AI took too long to answer. Nothing was changed; try again.');
    }
    const result = outcome.value;
    if (!result.available || !result.data) {
      return refused(503, 'unavailable', 'AI rewrite is unavailable right now. Nothing was changed.');
    }

    // For HTML, validateRewrite returns the sanitised HTML whose links and images it inspected.
    const checked = validateRewrite(body, protectedDraft, toDraftForm(result.data, draftIsHtml), draftIsHtml);
    if (!checked.ok) return refused(422, checked.reason, checked.message);

    const rewritten = checked.text;
    // The sanitiser must not have eaten a token either (one inside an attribute it dropped, say).
    if (!sameTemplateTokens(body, rewritten) || rewritten.trim() === '') {
      return refused(422, 'variables_changed', 'The rewrite changed your variables, so it was not used. Try again or edit by hand.');
    }
    // Images are protected too, but "kept as written" is about the template syntax the rep can see.
    const kept = protectedDraft.tokens.filter((token) => !token.startsWith('<')).length;
    // `format` is the draft's, so the preview never guesses from the text (a plain draft can read like markup).
    return NextResponse.json({ success: true, action, body: rewritten, kept, format: draftIsHtml ? 'html' : 'text' });
  } catch (error: unknown) {
    // The error's name only: a provider or parser message could quote the draft.
    console.error('[ai/compose-rewrite] failed:', error instanceof Error ? error.name : typeof error);
    return NextResponse.json({ success: false, error: 'Could not rewrite the draft' }, { status: 500 });
  }
}
