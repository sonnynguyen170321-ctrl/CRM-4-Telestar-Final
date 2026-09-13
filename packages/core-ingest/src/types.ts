import { z } from "zod";

export const V2_IMPORT_PROFILES = [
  "company_upload",
  "contact_upload",
  "lead_snapshot",
  "activity_event",
  "wide_activity_bundle",
  "pipeline_snapshot",
  "meeting_tracker",
  "unknown_mixed",
] as const;

export type V2ImportProfile = (typeof V2_IMPORT_PROFILES)[number];

export const V2_CANONICAL_MAPPING_FIELDS = [
  "company",
  "website",
  "domain",
  "email",
  "contact",
  "linkedin",
  "firstName",
  "lastName",
  "title",
  "department",
  "seniority",
  "contactPhone",
  "contactLinkedin",
  "contactCity",
  "contactCountry",
  "companyPhone",
  "companyIndustry",
  "companyCity",
  "companyCountry",
  "companyRevenue",
  "companyStaffCount"
] as const;

export type V2CanonicalMappingField =
  (typeof V2_CANONICAL_MAPPING_FIELDS)[number];

export const V2IngestionColumnMappingSchema = z
  .object({
    schemaVersion: z.literal("v2.ingestion.column-mapping.v1"),
    fields: z.object({
      company: z.string().nullable(),
      website: z.string().nullable(),
      domain: z.string().nullable(),
      email: z.string().nullable(),
      contact: z.string().nullable(),
      linkedin: z.string().nullable(),
      firstName: z.string().nullable().optional(),
      lastName: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      department: z.string().nullable().optional(),
      seniority: z.string().nullable().optional(),
      contactPhone: z.string().nullable().optional(),
      contactLinkedin: z.string().nullable().optional(),
      contactCity: z.string().nullable().optional(),
      contactCountry: z.string().nullable().optional(),
      companyPhone: z.string().nullable().optional(),
      companyIndustry: z.string().nullable().optional(),
      companyCity: z.string().nullable().optional(),
      companyCountry: z.string().nullable().optional(),
      companyRevenue: z.string().nullable().optional(),
      companyStaffCount: z.string().nullable().optional(),
    }),
  })
  .strict();

export type V2IngestionColumnMapping = z.infer<
  typeof V2IngestionColumnMappingSchema
>;

export const V2IngestionMappingContextSchema = z
  .object({
    schemaVersion: z.literal("v2.ingestion.mapping.v1"),
    runMode: z.enum(["auto_after_parse", "manual_mapping"]).default("auto_after_parse"),
    projectId: z.string().nullable().optional(),
    icpVersionId: z.string().nullable().optional(),
    originalFileName: z.string(),
    importProfileSuggestion: z.enum(V2_IMPORT_PROFILES),
    importProfileConfidence: z.enum(["low", "medium", "high"]),
    uploadIntake: z
      .object({
        schemaVersion: z.literal("v2.ingestion.upload-intake.v1"),
        clientRequestId: z.string(),
        sourceFileStorageKey: z.string(),
        fileHash: z.string(),
        headerHash: z.string(),
        headers: z.array(z.string()),
        previewRows: z.array(z.record(z.string(), z.string())).default([]),
        fileSizeBytes: z.number().int().nonnegative(),
      })
      .optional(),
    columnMapping: V2IngestionColumnMappingSchema.optional(),
    spreadsheetIntake: z
      .object({
        schemaVersion: z.literal("v2.ingestion.spreadsheet-intake.v1"),
        selectedSheet: z.string(),
        headerRow: z.number().int().nonnegative(),
        availableSheets: z
          .array(
            z.object({
              name: z.string(),
              rowCount: z.number().int().nonnegative(),
            })
          )
          .default([]),
      })
      .optional(),
    validationSummary: z
      .object({
        totalRows: z.number().int().nonnegative(),
        validRows: z.number().int().nonnegative(),
        invalidRows: z.number().int().nonnegative(),
        duplicateRows: z.number().int().nonnegative(),
        skippedRows: z.number().int().nonnegative(),
      })
      .optional(),
    notes: z.array(z.string()).default([]),
  })
  .strict();

export type V2IngestionMappingContext = z.infer<
  typeof V2IngestionMappingContextSchema
>;

export type V2RowCountSummary = {
  totalRows: number;
  persistedRows: number;
  duplicateRows: number;
  skippedRows: number;
  rawRows: number;
  normalizedRows: number;
  errorRows: number;
};

export type V2IngestionErrorSummary = {
  fatal: boolean;
  code: string | null;
  message: string | null;
  warnings: string[];
  parseErrors: number;
  validationErrors: number;
  invalidThresholdExceeded: boolean;
  stoppedEarly: boolean;
};

export type V2CsvIngestionInput = {
  organizationId: string;
  projectId?: string | null;
  icpVersionId?: string | null;
  uploadedByUserId?: string | null;
  runMode?: "auto_after_parse" | "manual_mapping";
  clientRequestId?: string | null;
  sourceFileStorageKey?: string | null;
  fileHash?: string | null;
  headerHash?: string | null;
  headers?: string[];
  previewRows?: Array<Record<string, string>>;
  fileSizeBytes?: number;
  originalFileName: string;
  csvText: string;
  importProfileSuggestion?: V2ImportProfile;
  spreadsheetIntake?: {
    schemaVersion: "v2.ingestion.spreadsheet-intake.v1";
    selectedSheet: string;
    headerRow: number;
    availableSheets: Array<{ name: string; rowCount: number }>;
  };
};

export type V2ParsedCsvRow = {
  sourceRowNumber: number;
  headers: string[];
  values: string[];
  rawRowJson: Record<string, string>;
  sourceRowHash: string;
  parseErrors: string[];
};

export type V2ParseCsvRowsInput = {
  csvText: string;
  chunkSize?: number;
  maxRows?: number;
  onRows: (rows: V2ParsedCsvRow[]) => Promise<void>;
};

export type V2ParseCsvRowsResult = {
  headers: string[];
  totalRows: number;
  blankRows: number;
  parseErrors: number;
  maxRowsExceeded: boolean;
};

export type V2ValidationResult = {
  ok: boolean;
  importProfile: V2ImportProfile;
  warnings: string[];
  errors: string[];
  normalizedRowJson: {
    schemaVersion: "v2.ingestion.normalized-row.v1";
    importProfile: V2ImportProfile;
    hints: Record<string, string | null>;
    warnings: string[];
  };
};

export type V2PersistRowsResult = {
  attemptedRows: number;
  insertedRows: number;
  duplicateRows: number;
  errorRows: number;
};


export const DEFAULT_CSV_CHUNK_SIZE = 500;
export const DEFAULT_DB_BATCH_SIZE = 200;
export const DEFAULT_MAX_CSV_ROWS = 50_000;
