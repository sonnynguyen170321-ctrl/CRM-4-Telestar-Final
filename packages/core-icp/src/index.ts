// ICP rule schema, templates and authoring helpers.
//
// This package holds DB-agnostic logic shared by the CRM (repository root) and apps/leadgen. The two
// apps have different schemas — Tenant/Account/Contact here, V2Organization/V2Company/V2Contact there
// — so anything that reaches for a database belongs in an app adapter, never here. A single
// `@prisma/client` import would tie this code to one schema and defeat the reason it was extracted.
//
// Enforced by the `no-restricted-imports` rule for packages/** in eslint.config.mjs.
export {};
