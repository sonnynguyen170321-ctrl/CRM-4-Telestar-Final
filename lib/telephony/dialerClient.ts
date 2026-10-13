import { buildTargetsUrl, type CallerIdOption, type DialTarget } from './dialerTargets';

/**
 * What the docked dialer asks the server besides placing the call: who can be called, and which company
 * numbers can be the caller ID. Plain functions with an injectable fetch so the failure branches are
 * unit-tested. Client-safe. A failure is reported, never turned into an empty list: "no results" and "the
 * search failed" are different things to a rep.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type TargetSearchResult = { ok: true; targets: DialTarget[] } | { ok: false; message: string };
export type CallerIdsResult = { ok: true; numbers: CallerIdOption[] } | { ok: false; message: string };

const doFetch = (fetchImpl?: Fetch): Fetch => fetchImpl ?? ((url, init) => fetch(url, init));

export async function searchTargets(query: string, options: { signal?: AbortSignal; fetchImpl?: Fetch } = {}): Promise<TargetSearchResult> {
  const url = buildTargetsUrl(query);
  if (!url) return { ok: true, targets: [] };
  try {
    const response = await doFetch(options.fetchImpl)(url, { cache: 'no-store', signal: options.signal });
    if (response.status === 429) return { ok: false, message: 'Too many searches. Wait a moment and try again.' };
    const body = (await response.json().catch(() => null)) as { targets?: unknown } | null;
    if (!response.ok || !body || !Array.isArray(body.targets)) return { ok: false, message: 'The search failed. Try again.' };
    return { ok: true, targets: body.targets as DialTarget[] };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { ok: false, message: 'Could not reach the server. Check your connection.' };
  }
}

export async function fetchCallerIds(fetchImpl?: Fetch): Promise<CallerIdsResult> {
  try {
    const response = await doFetch(fetchImpl)('/api/telephony/caller-ids', { cache: 'no-store' });
    const body = (await response.json().catch(() => null)) as { numbers?: unknown } | null;
    if (!response.ok || !body || !Array.isArray(body.numbers)) return { ok: false, message: 'The company numbers could not be loaded.' };
    return { ok: true, numbers: body.numbers as CallerIdOption[] };
  } catch {
    return { ok: false, message: 'The company numbers could not be loaded.' };
  }
}
