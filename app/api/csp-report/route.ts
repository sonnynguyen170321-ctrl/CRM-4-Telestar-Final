import { NextRequest, NextResponse } from 'next/server';

/**
 * Collects Content-Security-Policy violation reports.
 *
 * Unauthenticated by necessity: the browser posts these with no cookies and no session,
 * and a report that 401s teaches nobody anything. `proxy.ts` excludes this path for the
 * same reason it excludes the health probe.
 *
 * Because it is public it is also a free write endpoint, so it is deliberately cheap and
 * bounded: the body is size-capped, nothing is persisted, and output is one log line.
 * Reports are informational — they exist to tell us which directives are wrong before
 * enforcement, not to build a dataset.
 */

export const dynamic = 'force-dynamic';

/** Reports are small. Anything larger is not a browser doing its job. */
const MAX_BODY_BYTES = 8_192;

/** Both shapes browsers send: the legacy report-uri body and the Reporting API body. */
type LegacyReport = { 'csp-report'?: Record<string, unknown> };
type ReportingApiEntry = { type?: string; body?: Record<string, unknown> };

function summarize(report: Record<string, unknown>): string {
  const directive =
    report['effective-directive'] ?? report['violated-directive'] ?? report.effectiveDirective ?? 'unknown';
  const blocked = report['blocked-uri'] ?? report.blockedURL ?? 'unknown';
  const doc = report['document-uri'] ?? report.documentURL ?? 'unknown';
  return `directive=${String(directive)} blocked=${String(blocked)} document=${String(doc)}`;
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();

    if (raw.length > MAX_BODY_BYTES) {
      // No error detail back — this endpoint tells an anonymous caller nothing.
      return new NextResponse(null, { status: 413 });
    }

    const parsed: unknown = JSON.parse(raw);

    const reports: Record<string, unknown>[] = Array.isArray(parsed)
      ? (parsed as ReportingApiEntry[])
          .filter((entry) => !entry.type || entry.type === 'csp-violation')
          .map((entry) => entry.body ?? {})
      : [(parsed as LegacyReport)['csp-report'] ?? (parsed as Record<string, unknown>)];

    for (const report of reports) {
      if (report && Object.keys(report).length > 0) {
        // Report-only mode, so every one of these is a directive to fix rather than an
        // attack that was stopped. Logged at warn so they are visible without paging.
        console.warn(`[csp-report] ${summarize(report)}`);
      }
    }
  } catch {
    // Malformed report bodies are not worth an error path; swallow and move on.
  }

  // 204 regardless. Browsers ignore the response, and a uniform reply gives an anonymous
  // caller no signal about what was accepted.
  return new NextResponse(null, { status: 204 });
}
