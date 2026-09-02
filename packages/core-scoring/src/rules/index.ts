// SC1 multi-ICP rule engine — public surface for schema v2, reference dictionaries,
// and the v1->v2 lift. Consumed by SC2 scorers/gates and SC4 persistence/rescore.
//
// Explicit `./dictionaries/index` (not `./dictionaries`) keeps this barrel loadable
// by the smoke-script TS loader.

export * from "./schema-v2";
export * from "./dictionaries/index";
export * from "./evidence";
export * from "./normalize/index";
export { evaluateTerminalGates } from "./gates/terminalGates";
export * from "./dimensions/index";
export * from "./deriveQualification";
export { upgradeV1toV2 } from "./upgradeV1toV2";
