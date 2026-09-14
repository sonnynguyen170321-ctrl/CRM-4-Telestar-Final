import { AsyncLocalStorage } from 'async_hooks';

export type TenantContext = { tenantId: string; bypassRls?: boolean };

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * The tenant context every Prisma query is scoped by.
 *
 * This used to be the bare `AsyncLocalStorage`. It is now a thin wrapper whose one job is to
 * make `run()` settle the callback's result *inside* the context, and the reason is a property
 * of Prisma that is easy to forget: a `PrismaPromise` is lazy. The request is sent — and the
 * client extension's `query` hook, which reads `getStore()`, runs — only when something calls
 * `.then()` on it. So this common shape:
 *
 *     await tenantStorage.run({ tenantId }, () => prisma.lead.findUnique({ … }))
 *
 * returned the PrismaPromise, exited `run()`, and was awaited *outside* the context. The hook
 * saw no store, fell back to the session — or, with none, short-circuited to `[]` / `null` /
 * `Unauthorized`. The tenant the caller had passed was never seen. Twenty-one call sites had
 * this shape, including the API-key lookup in lib/auth.ts, which is why every API-key request
 * was a 401 in production and the whole `/api/v1` surface was unreachable for its only real
 * consumer. The `/api/v1` writes were "wrapped" the same way and believed safe.
 *
 * `run` now always awaits inside. The callback may return a value, a promise, or a lazy
 * PrismaPromise; all three settle with the store still set. The return type is a Promise in
 * every case — every existing caller already awaits it, and the change removes a foot-gun that
 * cannot otherwise be caught by review, since the broken shape reads as correct.
 */
export const tenantStorage = {
  getStore(): TenantContext | undefined {
    return storage.getStore();
  },

  async run<T>(context: TenantContext, callback: () => T): Promise<Awaited<T>> {
    // Two awaits, both load-bearing: the inner one settles a lazy PrismaPromise while the store
    // is set; the outer keeps this frame — and so the context — alive until it has.
    return await storage.run(context, async () => await callback());
  },
};
