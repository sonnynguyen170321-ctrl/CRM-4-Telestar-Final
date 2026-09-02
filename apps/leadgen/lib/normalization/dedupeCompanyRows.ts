import type { ParsedCsvRow } from "@/lib/csv";

export type CompanyRowDuplicate = {
  companyName: string;
  duplicateKey: string;
  duplicateKeyType: CompanyDuplicateKey["type"];
  sourceRowIndex: number;
  keptRowIndex: number;
};

export type CompanyDuplicateKey = {
  value: string;
  type: "website_domain" | "linkedin_url" | "name_country" | "unique_row";
};

export type DedupeCompanyRowsResult = {
  uniqueRows: Array<{
    row: ParsedCsvRow;
    sourceRowIndex: number;
    duplicateKey: string;
  }>;
  duplicates: CompanyRowDuplicate[];
};

export function dedupeCompanyRows(rows: ParsedCsvRow[]): DedupeCompanyRowsResult {
  const seen = new Map<string, number>();
  const uniqueRows: DedupeCompanyRowsResult["uniqueRows"] = [];
  const duplicates: CompanyRowDuplicate[] = [];

  rows.forEach((row, sourceRowIndex) => {
    const key = getCompanyDuplicateKey(row, sourceRowIndex);
    const keptRowIndex = seen.get(key.value);

    if (keptRowIndex !== undefined) {
      duplicates.push({
        companyName: getCell(row, "Company Name") || "Not provided",
        duplicateKey: key.value,
        duplicateKeyType: key.type,
        sourceRowIndex,
        keptRowIndex,
      });
      return;
    }

    seen.set(key.value, sourceRowIndex);
    uniqueRows.push({
      row,
      sourceRowIndex,
      duplicateKey: key.value,
    });
  });

  return { uniqueRows, duplicates };
}

function getCompanyDuplicateKey(
  row: ParsedCsvRow,
  sourceRowIndex: number
) {
  return buildCompanyDuplicateKey({
    website: getCell(row, "Website"),
    companyLinkedInUrl: getCell(row, "Company LinkedIn URL"),
    companyName: getCell(row, "Company Name"),
    companyCountry: getCell(row, "Company Country"),
    fallbackKey: `row:${sourceRowIndex}`,
  });
}

export function buildCompanyDuplicateKey({
  website,
  companyLinkedInUrl,
  companyName,
  companyCountry,
  fallbackKey,
}: {
  website?: string | null;
  companyLinkedInUrl?: string | null;
  companyName?: string | null;
  companyCountry?: string | null;
  fallbackKey: string;
}): CompanyDuplicateKey {
  const websiteDomain = normalizeWebsiteDomain(website ?? "");

  if (websiteDomain) {
    return {
      value: `website:${websiteDomain}`,
      type: "website_domain",
    };
  }

  const linkedinUrl = normalizeLinkedInUrl(companyLinkedInUrl ?? "");

  if (linkedinUrl) {
    return {
      value: `linkedin:${linkedinUrl}`,
      type: "linkedin_url",
    };
  }

  const normalizedCompanyName = normalizeText(companyName ?? "");
  const normalizedCompanyCountry = normalizeText(companyCountry ?? "");

  if (normalizedCompanyName || normalizedCompanyCountry) {
    return {
      value: `name_country:${normalizedCompanyName}|${normalizedCompanyCountry}`,
      type: "name_country",
    };
  }

  return {
    value: fallbackKey,
    type: "unique_row",
  };
}

function normalizeWebsiteDomain(value: string) {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return trimmed
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .trim();
  }
}

function normalizeLinkedInUrl(value: string) {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(
      /\/$/,
      ""
    )}`;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  }
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCell(row: ParsedCsvRow, key: string) {
  return row[key]?.trim() ?? "";
}
