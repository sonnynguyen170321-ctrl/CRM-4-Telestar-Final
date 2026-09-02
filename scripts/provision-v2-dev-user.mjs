#!/usr/bin/env node
// Back-compat shim. Prefer: npm run v2:signup -- --email you@example.com
await import("./v2-signup.mjs");