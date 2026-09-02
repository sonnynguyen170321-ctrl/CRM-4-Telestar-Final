// Ingestion vocabulary now lives in `@telestar/core-ingest`. What stays here is the one type that is
// database-shaped: the handle the persistence layer runs its raw SQL through.
export * from "@telestar/core-ingest/types";

export type { V2JobDatabase as V2IngestionDatabase } from "../jobs/types";
