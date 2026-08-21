/**
 * What a health probe has to show before gate 22 may pass.
 *
 * The gate previously failed only on `response.status >= 500`. Everything else passed: a `401`,
 * a `403`, a `302` to a login page, a proxy's HTML error page, and — most importantly — a
 * perfectly healthy server running an entirely different release. Its description read "web
 * health endpoints answer and report release identity" while the code never read `commit` at
 * all, and never received the candidate SHA to compare it against.
 *
 * It also probed `/api/health/db` and `/api/health/redis`, which do not exist in this
 * application and return `404` in production. Because 404 is under 500, the gate reported PASS
 * on two endpoints that have never existed (TEL-P1-034).
 *
 * So this module is deliberately strict and deliberately small: 200, JSON, `ok === true`, and
 * the commit equal to the frozen candidate. Anything else is a finding.
 */

export const HEALTH_ENDPOINTS = ['/api/health'];

/**
 * @param probe {{ endpoint: string, status: number|null, body: string, error?: string }}
 * @param expectedSha the frozen candidate SHA — never a value taken from the response
 */
export function evaluateHealthProbe(probe, expectedSha) {
  const { endpoint, status, body, error } = probe;
  const findings = [];

  if (error) {
    findings.push(`${endpoint}: request failed — ${error}`);
    return { ok: false, findings, commit: null };
  }

  if (status !== 200) {
    // Named individually because each means something different operationally, and the old
    // gate treated all of them as success.
    const explanation =
      status === 401 || status === 403
        ? ' — the endpoint is behind auth, so this proves nothing about the release'
        : status === 404
          ? ' — the endpoint does not exist'
          : status >= 300 && status < 400
            ? ' — a redirect, most likely to a login page'
            : '';
    findings.push(`${endpoint}: expected HTTP 200, got ${status}${explanation}`);
    return { ok: false, findings, commit: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A proxy or load balancer answering with an HTML error page is still a 200 sometimes.
    findings.push(`${endpoint}: body is not JSON (${body.slice(0, 60).replace(/\s+/g, ' ')}…)`);
    return { ok: false, findings, commit: null };
  }

  if (parsed === null || typeof parsed !== 'object') {
    findings.push(`${endpoint}: body is not a JSON object`);
    return { ok: false, findings, commit: null };
  }

  if (parsed.ok !== true) {
    const reason = typeof parsed.reason === 'string' ? ` (${parsed.reason})` : '';
    findings.push(`${endpoint}: reported ok=${JSON.stringify(parsed.ok)}${reason}`);
  }

  const commit = typeof parsed.commit === 'string' ? parsed.commit : null;
  if (commit === null) {
    findings.push(`${endpoint}: response carries no commit, so the release cannot be identified`);
  } else if (commit !== expectedSha) {
    findings.push(
      `${endpoint}: reports commit ${commit.slice(0, 7)}, expected the candidate ${expectedSha.slice(0, 7)}`,
    );
  }

  return { ok: findings.length === 0, findings, commit };
}

/** Every probe must pass. `expectedSha` comes from the frozen candidate, not from any response. */
export function evaluateHealthGate(probes, expectedSha) {
  const findings = [];
  const byEndpoint = {};

  if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    findings.push(`no valid candidate SHA to compare against (got ${expectedSha ?? 'nothing'})`);
  }
  if (!probes || probes.length === 0) {
    findings.push('no health endpoint was probed');
  }

  for (const probe of probes ?? []) {
    const result = evaluateHealthProbe(probe, expectedSha ?? '');
    byEndpoint[probe.endpoint] = {
      status: probe.status,
      commit: result.commit,
      findings: result.findings,
    };
    findings.push(...result.findings);
  }

  return { ok: findings.length === 0, findings, byEndpoint };
}
