import * as nodeModule from 'node:module';

// `module.registerHooks` is in Node 22.15+ and 24 (the image runs 24.18), but the repo's
// `@types/node` is pinned to 20 and does not declare it. Typed here to the part this file uses,
// and checked at runtime so an older Node fails with a sentence instead of `undefined is not a
// function`.
type ResolveContext = { conditions: string[] } & Record<string, unknown>;
type ResolveResult = { url: string } & Record<string, unknown>;
type RegisterHooks = (hooks: {
  resolve: (
    specifier: string,
    context: ResolveContext,
    nextResolve: (specifier: string, context?: ResolveContext) => ResolveResult
  ) => ResolveResult;
}) => unknown;

const registerHooks = (nodeModule as unknown as { registerHooks?: RegisterHooks }).registerHooks;
if (!registerHooks) {
  throw new Error(
    `The worker needs Node 22.15 or later (module.registerHooks); this is ${process.version}.`
  );
}

/**
 * Lets the worker load modules that carry `import "server-only"`.
 *
 * `server-only` is a build-time marker: Next resolves it with the `react-server` condition to an
 * empty file, and resolves it to a module that throws for anything bundled for the browser. The
 * worker is neither — it is plain Node under tsx — so it got the throwing default, and the first
 * worker to need the search provider chain (`research.discover`, through `@telestar/core-search`,
 * which reads API keys and so carries the marker) would have crashed the whole process on boot,
 * taking the send and sequence workers down with it. `tests/failure-matrix.test.ts` boots the real
 * worker and caught it.
 *
 * Scoped to the one specifier, deliberately. Running the worker with `--conditions=react-server`
 * would have fixed it too, and would also have switched every other package that publishes a
 * `react-server` export to its server-component build — a change to the worker's dependency
 * graph made to silence a marker. The worker is server code by definition, so telling the marker
 * so is the honest version.
 *
 * Must be the first import of `workers/index.ts`: the hook only affects resolutions that happen
 * after it is registered, and the entry compiles to CommonJS, where imports run in order.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return nextResolve(specifier, { ...context, conditions: [...context.conditions, 'react-server'] });
    }
    return nextResolve(specifier, context);
  },
});
