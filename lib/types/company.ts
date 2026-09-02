export type CompanyType =
  | "Not Relevant"
  | "PAAS"
  | "SAAS"
  | "Cloud"
  | "ITO"
  | "Data Solution"
  | "AI Solution"
  | "AI Service"
  | "Cyber Security"
  | "Blockchain Solution";

export type Qualification = "qualified" | "unqualified" | "uncertain";

export type ReviewState = "unreviewed" | "needs_review" | "reviewed";

export type UploadJobStatus = "queued" | "processing" | "completed" | "failed";

export type JsonObject = Record<string, unknown>;

export type UploadJob = {
  id: string;
  file_name: string;
  file_size: number;
  status: UploadJobStatus;
  total_rows: number;
  processed_rows: number;
  qualified_rows: number;
  rejected_rows: number;
  uncertain_rows: number;
  created_by?: string;
  created_at: string;
  completed_at?: string | null;
  error_message?: string | null;
};

export type CompanyRecord = {
  id: string;
  upload_job_id: string;
  company_name: string;
  website?: string | null;
  company_country?: string | null;
  company_linkedin_url?: string | null;
  company_industry?: string | null;
  company_phone_1?: string | null;
  company_staff_count_range?: string | null;
  raw_row_json: JsonObject;
  normalized_row_json?: JsonObject;
  created_at: string;
};

export type CompanyScoreResult = {
  company_name: string;
  website?: string;
  company_country?: string;
  type: CompanyType;
  note?: string;
  company_score: number;
  qualification: Qualification;
  confidence: number;
  reason: string;
  one_sentence_company_summary: string;
  hard_rule_flags: Record<string, boolean>;
  review_state: ReviewState;
};

export type FeedbackExample = {
  id: string;
  company_record_id: string;
  predicted_company_score?: number | null;
  predicted_company_type?: CompanyType | null;
  predicted_qualification?: Qualification | null;
  final_company_score?: number | null;
  final_company_type?: CompanyType | null;
  final_qualification?: Qualification | null;
  final_note?: string | null;
  reviewer?: string | null;
  created_at: string;
};

export type CompanyColumnKey =
  | "company_name"
  | "website"
  | "company_country"
  | "company_linkedin_url"
  | "company_industry"
  | "company_phone_1"
  | "company_staff_count_range"
  | "note";

export type ColumnMapping = Partial<Record<CompanyColumnKey, string>>;

export type CsvPreviewRow = Record<string, string | null>;
