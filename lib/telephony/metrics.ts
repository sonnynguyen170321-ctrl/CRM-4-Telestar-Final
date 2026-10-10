import { Prisma } from '@prisma/client';

import { withTenantRaw } from '@/lib/prisma';
import { PHONE_OUTCOMES } from '@/lib/telephony/outcomes';

/**
 * The one definition of "how many calls", for every dashboard, leaderboard and report.
 *
 * Calls reach the CRM from three places, and each surface used to count a different subset of them
 * (`call_logged` only, `call_made` only, or both):
 *
 *   1. `Call` rows - the browser softphone. The webhook worker also writes ONE `call_made` Activity
 *      per finished call and links it through `Call.activityId` and `metadata.callId`.
 *   2. `call_logged` Activities from the rep's own phone (`POST /api/telephony/phone-calls`).
 *   3. Legacy `call_logged` / `call_made` Activities (task completion, the v1 API, the older dialer).
 *
 * attempts  = outbound `Call` rows the provider was asked to place (`initiatedAt` set - a call that
 *             was blocked, or authorized and never initiated, is not an attempt)
 *           + call Activities that are NOT the shadow of a `Call` row (no `Call.activityId` match and no
 *             `metadata.callId`), so a softphone call is counted once, not as a row plus its activity.
 * connected = `Call` rows that were answered (`answeredAt` set)
 *           + unlinked call Activities whose recorded outcome is a connected one (group 'Connected' in
 *             `outcomes.ts`, plus the v1 API's `connected` and the `CallOutcome` name `meeting_booked`).
 *
 * Time: a `Call` is placed at `initiatedAt`; an Activity at its `createdAt`. `from` is inclusive and
 * `to` is inclusive (the report windows end at 23:59:59.999), either may be omitted.
 *
 * Tenant isolation: every statement filters `tenantId` explicitly and runs through `withTenantRaw`.
 */

export type CallMode = 'attempts' | 'connected';

export type CallScope = {
  /** Calls placed by these reps. An empty list matches nothing. */
  userIds?: string[];
  /** Calls on leads of this campaign. */
  campaignId?: string;
  /** Calls on these leads. An empty list matches nothing. */
  leadIds?: string[];
  /** Calls on leads of any campaign of this client. */
  clientId?: string;
  /** Calls on leads currently assigned to one of these reps (a manager's visibility window). */
  leadAssignedToIds?: string[];
};

export type CallRange = { from?: Date; to?: Date };

export type CountCallsParams = {
  tenantId: string;
  scope?: CallScope;
  range?: CallRange;
  mode: CallMode;
};

export type CallGroupBy = 'user' | 'lead' | 'day';

export type CountCallsGroupedParams = CountCallsParams & {
  by: CallGroupBy;
  /** IANA zone the `day` buckets are cut in. Default UTC. */
  timezone?: string;
};

/** Activity outcomes that mean a person was reached. Derived from the outcome list, not copied. */
export const CONNECTED_ACTIVITY_OUTCOMES: readonly string[] = Array.from(
  new Set([
    ...PHONE_OUTCOMES.filter((outcome) => outcome.group === 'Connected').flatMap((outcome) => [
      outcome.id,
      outcome.callOutcome,
    ]),
    // The v1 VoIP API reports a plain 'connected'.
    'connected',
  ]),
);

const CALL_ACTIVITY_TYPES = ['call_logged', 'call_made'] as const;

function scopeIsEmpty(scope: CallScope): boolean {
  return (
    (scope.userIds !== undefined && scope.userIds.length === 0) || (scope.leadIds !== undefined && scope.leadIds.length === 0) ||
    (scope.leadAssignedToIds !== undefined && scope.leadAssignedToIds.length === 0)
  );
}

/** Conditions on a table alias `t` whose columns are userId / leadId, plus the lead-based scopes. */
function scopeConditions(alias: Prisma.Sql, scope: CallScope, tenantId: string): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  const col = (name: string) => Prisma.raw(`${alias.sql}."${name}"`);
  if (scope.userIds) parts.push(Prisma.sql`${col('userId')} IN (${Prisma.join(scope.userIds)})`);
  if (scope.leadIds) parts.push(Prisma.sql`${col('leadId')} IN (${Prisma.join(scope.leadIds)})`);
  if (scope.campaignId || scope.clientId || scope.leadAssignedToIds) {
    const assigned = scope.leadAssignedToIds
      ? Prisma.sql`AND l."assignedToId" IN (${Prisma.join(scope.leadAssignedToIds)})`
      : Prisma.empty;
    const campaign = scope.campaignId ? Prisma.sql`AND l."campaignId" = ${scope.campaignId}` : Prisma.empty;
    const client = scope.clientId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Campaign" cp WHERE cp.id = l."campaignId" AND cp."tenantId" = ${tenantId} AND cp."clientId" = ${scope.clientId})`
      : Prisma.empty;
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Lead" l WHERE l.id = ${col('leadId')} AND l."tenantId" = ${tenantId} ${campaign} ${client} ${assigned})`,
    );
  }
  return parts;
}

/**
 * A bound as a UTC `timestamp`, the type of every Prisma DateTime column. Passed bare, the driver
 * sends a zoned value and Postgres converts the column through the session time zone, which moves
 * the window by the zone's offset.
 */
const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function rangeConditions(column: Prisma.Sql, range: CallRange): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  if (range.from) parts.push(Prisma.sql`${column} >= ${utc(range.from)}`);
  if (range.to) parts.push(Prisma.sql`${column} <= ${utc(range.to)}`);
  return parts;
}

function and(parts: Prisma.Sql[]): Prisma.Sql {
  return parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
}

/** Every countable call as (userId, leadId, at): Call rows UNION ALL the Activities that are not their shadow. */
function countableCalls(params: CountCallsParams): Prisma.Sql {
  const { tenantId, mode } = params;
  const scope = params.scope ?? {};
  const range = params.range ?? {};

  const callParts: Prisma.Sql[] = [
    Prisma.sql`c."tenantId" = ${tenantId}`,
    Prisma.sql`c.direction = 'outbound'`,
    Prisma.sql`c."initiatedAt" IS NOT NULL`,
    ...(mode === 'connected' ? [Prisma.sql`c."answeredAt" IS NOT NULL`] : []),
    ...rangeConditions(Prisma.sql`c."initiatedAt"`, range),
    ...scopeConditions(Prisma.raw('c'), scope, tenantId),
  ];

  const activityParts: Prisma.Sql[] = [
    Prisma.sql`a."tenantId" = ${tenantId}`,
    Prisma.sql`a.type::text IN (${Prisma.join([...CALL_ACTIVITY_TYPES])})`,
    Prisma.sql`a.metadata->>'callId' IS NULL`,
    Prisma.sql`NOT EXISTS (SELECT 1 FROM "Call" k WHERE k."activityId" = a.id AND k."tenantId" = ${tenantId})`,
    ...(mode === 'connected' ? [Prisma.sql`a.metadata->>'outcome' IN (${Prisma.join([...CONNECTED_ACTIVITY_OUTCOMES])})`] : []),
    ...rangeConditions(Prisma.sql`a."createdAt"`, range),
    ...scopeConditions(Prisma.raw('a'), scope, tenantId),
  ];

  return Prisma.sql`
    SELECT c."userId" AS "userId", c."leadId" AS "leadId", c."initiatedAt" AS "at"
    FROM "Call" c WHERE ${and(callParts)}
    UNION ALL
    SELECT a."userId", a."leadId", a."createdAt"
    FROM "Activity" a WHERE ${and(activityParts)}`;
}

/** The number of calls in scope and range, by the one definition above. */
export async function countCalls(params: CountCallsParams): Promise<number> {
  if (scopeIsEmpty(params.scope ?? {})) return 0;
  const rows = await withTenantRaw(params.tenantId, (db) =>
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM (${countableCalls(params)}) x`),
  );
  return rows[0]?.n ?? 0;
}

/**
 * The same count, grouped by rep, lead or local day (`YYYY-MM-DD`). Rows without the grouping key
 * (a Call nobody answered has no user, an Activity may have no lead) are left out of the groups, so
 * the groups can sum to less than `countCalls`.
 */
export async function countCallsBy(params: CountCallsGroupedParams): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (scopeIsEmpty(params.scope ?? {})) return result;

  const key =
    params.by === 'user'
      ? Prisma.sql`"userId"`
      : params.by === 'lead'
        ? Prisma.sql`"leadId"`
        : Prisma.sql`to_char(("at" AT TIME ZONE 'UTC') AT TIME ZONE ${params.timezone ?? 'UTC'}, 'YYYY-MM-DD')`;

  const rows = await withTenantRaw(params.tenantId, (db) =>
    db.$queryRaw<Array<{ key: string | null; n: number }>>(
      Prisma.sql`SELECT ${key} AS key, count(*)::int AS n FROM (${countableCalls(params)}) x WHERE ${key} IS NOT NULL GROUP BY 1`,
    ),
  );
  for (const row of rows) if (row.key) result.set(row.key, row.n);
  return result;
}
