// The identity module now lives in `@telestar/core-identity`, shared with the CRM at the repository
// root. This file stays as the forwarding point so the seven call sites in this app keep importing
// `@/lib/v2/identity` and there is still exactly one implementation, not a copy per app.
export * from "@telestar/core-identity";
