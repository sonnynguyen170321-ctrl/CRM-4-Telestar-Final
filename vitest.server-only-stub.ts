// Stub for the `server-only` package when package tests run outside Next.
//
// `server-only` exists to make a build fail if server code is imported into a client bundle. Outside
// a bundler it simply throws on import, which would mean any module carrying that guard — the search
// provider chain reads API keys, so it carries one — could never be unit tested.
//
// Replacing it here does not weaken the guarantee: the guard is enforced at build time by Next, which
// is where a client bundle is actually produced. Tests only need the module to load.
export {};
