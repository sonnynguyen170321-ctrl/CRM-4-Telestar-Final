import type { ColumnMapping, CompanyColumnKey, CsvPreviewRow } from "@/lib/types";

export type MappingStatus = "mapped" | "suggested" | "optional" | "missing";

export type MappingRequirement = "required" | "recommended" | "optional";

export type MappingRow = {
  key: CompanyColumnKey;
  label: string;
  requirement: MappingRequirement;
  mappedHeader?: string;
  status: MappingStatus;
};

export const sourceCsvHeaders = [
  "Company Name",
  "Website",
  "Company Country",
  "Company LinkedIn URL",
  "Company Industry",
  "Company Phone 1",
  "Company Staff Count Range",
  "Notes / Tags",
  "Lead Name",
  "Title",
];

export const mockColumnMapping: ColumnMapping = {
  company_name: "Company Name",
  website: "Website",
  company_country: "Company Country",
  company_linkedin_url: "Company LinkedIn URL",
  company_industry: "Company Industry",
  company_phone_1: "Company Phone 1",
  company_staff_count_range: "Company Staff Count Range",
  note: "Notes / Tags",
};

export const mappingRows: MappingRow[] = [
  {
    key: "company_name",
    label: "Company Name",
    requirement: "required",
    mappedHeader: mockColumnMapping.company_name,
    status: "mapped",
  },
  {
    key: "website",
    label: "Website",
    requirement: "required",
    mappedHeader: mockColumnMapping.website,
    status: "mapped",
  },
  {
    key: "company_country",
    label: "Company Country",
    requirement: "recommended",
    mappedHeader: mockColumnMapping.company_country,
    status: "suggested",
  },
  {
    key: "company_linkedin_url",
    label: "Company LinkedIn URL",
    requirement: "recommended",
    mappedHeader: mockColumnMapping.company_linkedin_url,
    status: "suggested",
  },
  {
    key: "company_industry",
    label: "Company Industry",
    requirement: "recommended",
    mappedHeader: mockColumnMapping.company_industry,
    status: "suggested",
  },
  {
    key: "company_phone_1",
    label: "Company Phone 1",
    requirement: "optional",
    mappedHeader: mockColumnMapping.company_phone_1,
    status: "optional",
  },
  {
    key: "company_staff_count_range",
    label: "Company Staff Count Range",
    requirement: "recommended",
    mappedHeader: mockColumnMapping.company_staff_count_range,
    status: "mapped",
  },
  {
    key: "note",
    label: "Notes / Tags",
    requirement: "optional",
    mappedHeader: mockColumnMapping.note,
    status: "optional",
  },
];

export const csvPreviewRows: CsvPreviewRow[] = [
  {
    "Company Name": "Northstar Cloud",
    Website: "northstarcloud.example",
    "Company Country": "Canada",
    "Company LinkedIn URL": "linkedin.com/company/northstar-cloud",
    "Company Industry": "Cloud Infrastructure",
    "Company Staff Count Range": "51-200",
    "Notes / Tags": "B2B platform",
    "Lead Name": "Maya Patel",
    Title: "VP Sales",
  },
  {
    "Company Name": "Vector Ledger",
    Website: "vectorledger.example",
    "Company Country": "United Kingdom",
    "Company LinkedIn URL": "linkedin.com/company/vector-ledger",
    "Company Industry": "Blockchain",
    "Company Staff Count Range": "11-50",
    "Notes / Tags": "Needs review",
    "Lead Name": "Noah Smith",
    Title: "Founder",
  },
  {
    "Company Name": "AgencyWorks Studio",
    Website: "agencyworks.example",
    "Company Country": "Australia",
    "Company LinkedIn URL": "linkedin.com/company/agencyworks-studio",
    "Company Industry": "Software Services",
    "Company Staff Count Range": "3-10",
    "Notes / Tags": "Service-led",
    "Lead Name": "Olivia Chen",
    Title: "Director",
  },
];
