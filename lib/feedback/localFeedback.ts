import type { CompanyScoreResult, CompanyType, Qualification } from "@/lib/types";

export type LocalFeedbackInput = {
  company: CompanyScoreResult;
  id?: string;
  final_company_score: number;
  final_company_type: CompanyType;
  final_qualification: Qualification;
  final_note: string;
};

export type LocalFeedbackExample = {
  id: string;
  company_name: string;
  website?: string;
  predicted_company_score: number;
  predicted_company_type: CompanyType;
  predicted_qualification: Qualification;
  final_company_score: number;
  final_company_type: CompanyType;
  final_qualification: Qualification;
  final_note: string;
  created_at: string;
};

export const localFeedbackCompanyTypes: CompanyType[] = [
  "Not Relevant",
  "PAAS",
  "SAAS",
  "Cloud",
  "ITO",
  "Data Solution",
  "AI Solution",
  "AI Service",
  "Cyber Security",
  "Blockchain Solution",
];

export const localFeedbackQualifications: Qualification[] = [
  "qualified",
  "unqualified",
  "uncertain",
];

export function createLocalFeedback({
  company,
  id,
  final_company_score,
  final_company_type,
  final_qualification,
  final_note,
}: LocalFeedbackInput): LocalFeedbackExample {
  return {
    id: id ?? `${company.company_name}-${company.website ?? "no-website"}-${Date.now()}`,
    company_name: company.company_name,
    website: company.website,
    predicted_company_score: company.company_score,
    predicted_company_type: company.type,
    predicted_qualification: company.qualification,
    final_company_score,
    final_company_type,
    final_qualification,
    final_note,
    created_at: new Date().toISOString(),
  };
}

export function getLocalFeedbackKey(company: Pick<CompanyScoreResult, "company_name" | "website">) {
  return `${company.company_name}::${company.website ?? ""}`;
}
