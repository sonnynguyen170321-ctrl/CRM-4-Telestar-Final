/**
 * Raw API access as a specific role, independent of any browser page.
 *
 * §7 is explicit that authorization must be tested at the API and not only through hidden
 * buttons: a role whose sidebar entry is missing but whose endpoint answers 200 is not
 * restricted, it is merely undiscoverable. This helper builds a request context from a
 * role's stored session so a spec can call the endpoint directly.
 */
import { request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { storageStatePath, type RoleKey } from './fixture';

export async function apiAs(role: RoleKey, baseURL: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL, storageState: storageStatePath(role) });
}

/** An unauthenticated context, for asserting that protected routes actually reject. */
export async function apiAnonymous(baseURL: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL });
}

/**
 * Status plus parsed body in one shape.
 *
 * BUG-003 in `docs/post-migration/BUGS.md` records what happens without this: fire-and-forget
 * requests whose 404s were invisible, and assertions on `response.ok()` that never looked at
 * what came back. Every audit call reads both.
 */
export async function readJson(res: APIResponse): Promise<{ status: number; body: unknown }> {
  const status = res.status();
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Left as text — an HTML error page is itself evidence worth surfacing.
  }
  return { status, body };
}
