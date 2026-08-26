/**
 * Insert a row that the current constraints would refuse.
 *
 * Some tests need a cross-tenant row on disk in order to prove that the application layer
 * does not disclose it. Since the composite tenant foreign keys landed, such a row can no
 * longer be created by ordinary means - which is the point of them - so the test that proves
 * the second line of defence can no longer reach the state it exists to cover.
 *
 * `session_replication_role = replica` suppresses foreign key triggers for the duration of a
 * transaction, which is precisely "a row written before the constraint existed". It is not a
 * way to weaken the constraint: `SET LOCAL` reverts at commit, so nothing outside this
 * transaction is affected, and any attempt to write the same row through the application
 * still fails.
 *
 * Requires a superuser connection, which the test databases use. Not usable, and not intended
 * to be usable, against a deployment where the application role is unprivileged.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

type RawCapable = {
  $transaction: <R>(fn: (tx: unknown) => Promise<R>) => Promise<R>;
};

/**
 * Runs `sql` with foreign key triggers suppressed.
 *
 * The statement is executed on the same connection as the `SET LOCAL`, which is why this uses
 * an interactive transaction rather than two calls against the pool - the pool would be free
 * to hand the INSERT a different connection, where the setting does not apply, and the test
 * would fail for a reason that has nothing to do with what it is testing.
 */
export async function insertBypassingForeignKeys(
  prisma: PrismaClient | RawCapable,
  sql: Prisma.Sql,
): Promise<void> {
  await (prisma as RawCapable).$transaction(async (tx) => {
    const t = tx as { $executeRawUnsafe: (q: string) => Promise<unknown>; $executeRaw: (q: Prisma.Sql) => Promise<unknown> };
    await t.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
    await t.$executeRaw(sql);
  });
}
