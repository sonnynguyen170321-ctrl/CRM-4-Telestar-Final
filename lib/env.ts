import { z } from 'zod';

import { OPTIONAL_ENV_GROUPS } from './env-contract';

/**
 * Fail-fast env validation, run once at boot from instrumentation.ts.
 * Required vars throw; optional integration groups only warn so the app
 * still runs without (e.g.) Microsoft OAuth configured.
 */
const requiredSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
});

/**
 * The optional groups come from `lib/env-contract.ts`, not from a list kept here.
 *
 * This file used to declare its own, and it had drifted: the AI group named `GROQ_API_KEY`
 * alone, dating from when Groq was primary and Gemini the fallback. The product now routes
 * across three providers, and `scripts/prod-check-env.ts` already required all three — so a
 * deployment missing the OpenAI and Gemini credentials booted without a single warning, while
 * the deploy gate would have refused it.
 */
const OPTIONAL_GROUPS = OPTIONAL_ENV_GROUPS;

export function validateEnv(): void {
  const result = requiredSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${details}`);
  }

  for (const [group, vars] of Object.entries(OPTIONAL_GROUPS)) {
    const missing = vars.filter((v) => !process.env[v]);
    if (missing.length > 0 && missing.length < vars.length) {
      console.warn(`[env] ${group} is partially configured — missing: ${missing.join(', ')}`);
    } else if (missing.length === vars.length && process.env.NODE_ENV === 'production') {
      console.warn(`[env] ${group} not configured (${vars.join(', ')}) — related features disabled`);
    }
  }
}
