import type {
  ActivityColumnMapping,
  ActivityColumnMappingSuggestion,
  CanonicalActivityField,
} from "@/lib/activityRecaps/types";

export const canonicalActivityFields: Array<{
  field: CanonicalActivityField;
  label: string;
  required?: boolean;
  allowMultiple?: boolean;
}> = [
  { field: "sdrName", label: "SDR name", required: true },
  { field: "leadName", label: "Lead name", required: true },
  { field: "companyName", label: "Company name", required: true },
  { field: "website", label: "Website" },
  { field: "title", label: "Title" },
  { field: "contactLinkedInUrl", label: "Contact LinkedIn URL" },
  { field: "email", label: "Email" },
  { field: "phone", label: "Phone" },
  { field: "companyCountry", label: "Company country" },
  { field: "contactCountry", label: "Contact country" },
  { field: "companyLinkedInUrl", label: "Company LinkedIn URL" },
  { field: "companyIndustry", label: "Company industry" },
  { field: "companyStaffCountRange", label: "Company staff count range" },
  { field: "activityDate", label: "Activity date" },
  { field: "weekLabel", label: "Week label" },
  { field: "linkedinStage", label: "LinkedIn stage" },
  { field: "linkedinDate", label: "LinkedIn date" },
  { field: "emailStage", label: "Email stage" },
  { field: "emailDate", label: "Email date" },
  { field: "callStage", label: "Call stage" },
  { field: "callDate", label: "Call date" },
  { field: "otherChannelStage", label: "Other channel stage" },
  { field: "otherChannelDate", label: "Other channel date" },
  { field: "channelResponded", label: "Channel responded" },
  { field: "meetingDate", label: "Meeting date" },
  { field: "meetingStatus", label: "Meeting status" },
  {
    field: "noteCombined",
    label: "Combined notes",
    allowMultiple: true,
  },
];

const synonyms: Partial<Record<CanonicalActivityField, string[]>> = {
  sdrName: ["pic", "sdr", "sdr name", "owner", "assignee", "bdr", "rep", "sales rep"],
  leadName: [
    "lead name",
    "contact full name",
    "contact name",
    "full name",
    "name",
  ],
  companyName: ["company name", "company name cleaned", "company", "account", "account name"],
  website: ["website", "company website", "domain"],
  title: ["title", "job title"],
  contactLinkedInUrl: [
    "contact li url",
    "contact li profile url",
    "contact linkedin",
    "linkedin url",
    "li profile",
    "contact li profile",
  ],
  email: ["email", "email address", "work email", "email 1"],
  phone: ["phone", "phone number", "contact phone", "contact phone 1"],
  companyCountry: ["company country", "account country", "country"],
  contactCountry: ["contact country", "lead country"],
  companyLinkedInUrl: ["company linkedin url", "company linkedin", "account linkedin"],
  companyIndustry: ["company industry", "industry"],
  companyStaffCountRange: [
    "company staff count range",
    "staff count range",
    "employee range",
    "employees",
  ],
  activityDate: ["activity date", "date", "modified time"],
  weekLabel: ["week lable", "week label", "week"],
  linkedinStage: [
    "stage",
    "linkedin stage",
    "linkedin status",
    "li status",
    "linkedin status",
  ],
  linkedinDate: [
    "timestamp linkedin",
    "timestamp linkedin",
    "li first touch date",
    "linkedin first touch date",
  ],
  emailStage: ["email stage", "email sent", "email status", "1st email", "email 1 stage"],
  emailDate: ["timestamp email", "email first touch date"],
  callStage: ["call stage", "call made", "call status", "call got response"],
  callDate: ["timestamp call", "call first touch date"],
  noteCombined: [
    "notes",
    "note",
    "call note",
    "linkedin note",
    "email note",
    "note topic solution replies decline reason",
  ],
  otherChannelStage: [
    "other channel stage",
    "other social media platforms",
    "wa",
    "whatsapp",
    "zalo",
  ],
  otherChannelDate: ["other channel date", "whatsapp date", "zalo date"],
  meetingDate: ["meeting date"],
  meetingStatus: ["meeting status"],
  channelResponded: ["channel responded", "responded", "got response"],
};

export function suggestActivityColumnMappings(
  headers: string[],
  rows: Record<string, string>[] = []
): ActivityColumnMappingSuggestion[] {
  const suggestions = canonicalActivityFields.map(({ field }) =>
    suggestField(field, headers, rows)
  );

  const directSdr = suggestions.find((suggestion) => suggestion.canonicalField === "sdrName");
  if (!directSdr?.selectedColumns.length) {
    const listHeader = findHeader(headers, ["list"]);
    if (listHeader) {
      suggestions.splice(
        suggestions.findIndex((suggestion) => suggestion.canonicalField === "sdrName"),
        1,
        {
          canonicalField: "sdrName",
          selectedColumns: [listHeader],
          confidence: 48,
          reason: "Using List as a fallback; SDR can often be parsed from names like Tele_27.05_Gary.",
        }
      );
    }
  }

  return suggestions;
}

export function suggestionsToMapping(
  suggestions: ActivityColumnMappingSuggestion[]
): ActivityColumnMapping {
  return suggestions.reduce<ActivityColumnMapping>((mapping, suggestion) => {
    if (suggestion.selectedColumns.length > 0) {
      mapping[suggestion.canonicalField] = suggestion.selectedColumns;
    }
    return mapping;
  }, {});
}

function suggestField(
  field: CanonicalActivityField,
  headers: string[],
  rows: Record<string, string>[]
): ActivityColumnMappingSuggestion {
  const fieldSynonyms = synonyms[field] ?? [];

  if (field === "noteCombined") {
    const noteColumns = headers.filter((header) =>
      fieldSynonyms.some((synonym) => normalizedHeader(header).includes(synonym))
    );

    return {
      canonicalField: field,
      selectedColumns: noteColumns,
      confidence: noteColumns.length > 0 ? 92 : 0,
      reason:
        noteColumns.length > 0
          ? "Detected note-like columns; blanks will be skipped and values combined."
          : "No note-like columns detected.",
    };
  }

  const exact = findExactHeader(headers, fieldSynonyms);
  if (exact) {
    return {
      canonicalField: field,
      selectedColumns: [exact],
      confidence: 96,
      reason: `Header "${exact}" matches a known ${field} synonym.`,
    };
  }

  const fuzzy = findHeader(headers, fieldSynonyms);
  if (fuzzy) {
    return {
      canonicalField: field,
      selectedColumns: [fuzzy],
      confidence: 78,
      reason: `Header "${fuzzy}" looks like a ${field} column.`,
    };
  }

  const valueHint = valueBasedHint(field, headers, rows);
  if (valueHint) {
    return valueHint;
  }

  return {
    canonicalField: field,
    selectedColumns: [],
    confidence: 0,
    reason: "No confident match detected.",
  };
}

function findExactHeader(headers: string[], candidates: string[]) {
  return headers.find((header) =>
    candidates.some((candidate) => normalizedHeader(header) === candidate)
  );
}

function findHeader(headers: string[], candidates: string[]) {
  return headers.find((header) =>
    candidates.some((candidate) => normalizedHeader(header).includes(candidate))
  );
}

function valueBasedHint(
  field: CanonicalActivityField,
  headers: string[],
  rows: Record<string, string>[]
): ActivityColumnMappingSuggestion | null {
  if (rows.length === 0) {
    return null;
  }

  const scoredHeaders = headers
    .map((header) => {
      const values = rows.slice(0, 80).map((row) => row[header] ?? "");
      return { header, score: scoreValuesForField(field, values) };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scoredHeaders[0];
  if (!best) {
    return null;
  }

  return {
    canonicalField: field,
    selectedColumns: [best.header],
    confidence: Math.min(72, 40 + best.score),
    reason: `Values in "${best.header}" look like ${field}.`,
  };
}

function scoreValuesForField(field: CanonicalActivityField, values: string[]) {
  const nonBlank = values.filter((value) => value.trim().length > 0);
  if (nonBlank.length === 0) {
    return 0;
  }

  const sample = nonBlank.join(" \n ").toLowerCase();

  if (field === "contactLinkedInUrl") {
    return countMatches(nonBlank, /linkedin\.com\/in/i) * 12;
  }

  if (field === "email") {
    return countMatches(nonBlank, /\S+@\S+\.\S+/) * 12;
  }

  if (field === "activityDate" || field.endsWith("Date")) {
    return countMatches(nonBlank, /\b(\d{1,2}[/-]\d{1,2}|\d{4}-\d{2}-\d{2})\b/) * 8;
  }

  if (field === "callStage") {
    return /\b(npu|pu|no pick\s?up|pickup|not interested|call no pickup)\b/i.test(sample)
      ? 40
      : 0;
  }

  if (field === "linkedinStage") {
    return /\b(linkedin sent|linkedin mess|linkedin message|connected|li status)\b/i.test(sample)
      ? 38
      : 0;
  }

  return 0;
}

function countMatches(values: string[], pattern: RegExp) {
  return values.filter((value) => pattern.test(value)).length;
}

function normalizedHeader(header: string) {
  return header
    .toLowerCase()
    .replace(/[:?()[\]_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

