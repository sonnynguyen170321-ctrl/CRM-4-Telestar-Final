import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";
import { summarizeCompanyMatches } from "@/lib/activityRecaps/companyMatchSummary";
import type { CompanyMatchStatus } from "@/lib/activityRecaps/types";

export type ActivityCompanyMatchSummary = {
  uploadId: string;
  totalRows: number;
  matched: number;
  suggested: number;
  noMatch: number;
  ambiguous: number;
  matchRate: number;
};

type ActivityRowForMatching = Prisma.SdrActivityRowGetPayload<object>;

type CompanyCandidate = Pick<
  Prisma.CompanyRecordGetPayload<object>,
  "id" | "companyName" | "website" | "companyCountry" | "companyLinkedInUrl"
>;

type MatchDecision = {
  matchedCompanyRecordId: string | null;
  companyMatchStatus: CompanyMatchStatus;
  companyMatchConfidence: number;
  companyMatchReason: string;
  companyMatchKey: string | null;
};

export async function matchActivityRowsToCompanies(
  activityUploadId: string
): Promise<ActivityCompanyMatchSummary> {
  const [rows, companies] = await Promise.all([
    prisma.sdrActivityRow.findMany({
      where: { activityUploadId },
      orderBy: { rowIndex: "asc" },
    }),
    prisma.companyRecord.findMany({
      where: {
        deletedAt: null,
        archivedAt: null,
      },
      select: {
        id: true,
        companyName: true,
        website: true,
        companyCountry: true,
        companyLinkedInUrl: true,
      },
    }),
  ]);

  const indexedCompanies = buildCompanyIndex(companies);
  const updates = rows.map((row) => ({
    id: row.id,
    decision: matchActivityRow(row, indexedCompanies),
  }));

  await prisma.$transaction(
    updates.map(({ id, decision }) =>
      prisma.sdrActivityRow.update({
        where: { id },
        data: decision,
      })
    )
  );

  const summary = summarizeCompanyMatches(
    updates.map(({ decision }) => ({
      companyMatchStatus: decision.companyMatchStatus,
      matchedCompanyRecordId: decision.matchedCompanyRecordId ?? undefined,
    }))
  );

  return {
    uploadId: activityUploadId,
    totalRows: summary.totalRows,
    matched: summary.matchedRows,
    suggested: summary.suggestedRows,
    noMatch: summary.noMatchRows,
    ambiguous: summary.ambiguousRows,
    matchRate: summary.matchRate,
  };
}

function buildCompanyIndex(companies: CompanyCandidate[]) {
  return {
    companies,
    byDomain: groupBy(companies, (company) => normalizeDomain(company.website)),
    byLinkedIn: groupBy(companies, (company) =>
      normalizeLinkedInCompanyUrl(company.companyLinkedInUrl)
    ),
    byNameCountry: groupBy(companies, (company) =>
      nameCountryKey(company.companyName, company.companyCountry)
    ),
  };
}

function matchActivityRow(
  row: ActivityRowForMatching,
  index: ReturnType<typeof buildCompanyIndex>
): MatchDecision {
  const websiteDomain = normalizeDomain(row.website);
  if (websiteDomain) {
    const domainMatches = index.byDomain.get(websiteDomain) ?? [];
    const decision = decideExactMatches(
      domainMatches,
      row,
      "domain",
      100,
      `Website domain matched ${websiteDomain}.`
    );
    if (decision) {
      return decision;
    }
  }

  const linkedinUrl = normalizeLinkedInCompanyUrl(row.companyLinkedInUrl);
  if (linkedinUrl) {
    const linkedInMatches = index.byLinkedIn.get(linkedinUrl) ?? [];
    const decision = decideExactMatches(
      linkedInMatches,
      row,
      "company_linkedin",
      95,
      "Company LinkedIn URL matched exactly."
    );
    if (decision) {
      return decision;
    }
  }

  const emailDomain = extractEmailDomain(row.email);
  if (emailDomain) {
    const emailDomainMatches = index.byDomain.get(emailDomain) ?? [];
    if (emailDomainMatches.length === 1) {
      const candidate = emailDomainMatches[0];
      const similarity = companyNameSimilarity(row.companyName, candidate.companyName);
      if (similarity >= 0.7) {
        return matched(
          candidate.id,
          "matched",
          90,
          "Email domain matched company website and company name is similar.",
          "email_domain"
        );
      }

      return matched(
        candidate.id,
        "suggested",
        75,
        "Email domain matched company website, but company name differs.",
        "email_domain"
      );
    }

    if (emailDomainMatches.length > 1) {
      return ambiguous(
        `Email domain matched ${emailDomainMatches.length} existing company records.`,
        "email_domain"
      );
    }
  }

  const nameCountry = nameCountryKey(row.companyName, row.companyCountry);
  if (nameCountry) {
    const nameCountryMatches = index.byNameCountry.get(nameCountry) ?? [];
    const decision = decideExactMatches(
      nameCountryMatches,
      row,
      "name_country",
      85,
      "Company name and country matched exactly after normalization."
    );
    if (decision) {
      return decision;
    }
  }

  const fuzzyCandidates = index.companies
    .filter((company) => countriesMatch(row.companyCountry, company.companyCountry))
    .map((company) => ({
      company,
      similarity: companyNameSimilarity(row.companyName, company.companyName),
    }))
    .filter((candidate) => candidate.similarity >= 0.9)
    .sort((a, b) => b.similarity - a.similarity);

  if (fuzzyCandidates.length > 0) {
    const top = fuzzyCandidates[0];
    const second = fuzzyCandidates[1];
    if (second && top.similarity - second.similarity < 0.03) {
      return ambiguous(
        `Fuzzy company name matched ${fuzzyCandidates.length} close candidates.`,
        "fuzzy_name"
      );
    }

    return matched(
      top.company.id,
      "suggested",
      75,
      `Fuzzy company name matched with ${Math.round(top.similarity * 100)}% similarity and country matched.`,
      "fuzzy_name"
    );
  }

  return {
    matchedCompanyRecordId: null,
    companyMatchStatus: "no_match",
    companyMatchConfidence: 0,
    companyMatchReason: "No reliable existing company match found.",
    companyMatchKey: null,
  };
}

function decideExactMatches(
  candidates: CompanyCandidate[],
  row: ActivityRowForMatching,
  key: string,
  confidence: number,
  reason: string
): MatchDecision | null {
  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return matched(candidates[0].id, "matched", confidence, reason, key);
  }

  const normalizedRowName = normalizeCompanyName(row.companyName);
  const matchingNameCandidates = candidates.filter(
    (candidate) => normalizeCompanyName(candidate.companyName) === normalizedRowName
  );

  if (matchingNameCandidates.length === 1) {
    return matched(
      matchingNameCandidates[0].id,
      "matched",
      confidence,
      `${reason} Multiple domain candidates existed, but company name disambiguated the match.`,
      key
    );
  }

  return ambiguous(
    `${reason} ${candidates.length} existing company records matched, so no row was auto-linked.`,
    key
  );
}

function matched(
  id: string,
  status: "matched" | "suggested",
  confidence: number,
  reason: string,
  key: string
): MatchDecision {
  return {
    matchedCompanyRecordId: id,
    companyMatchStatus: status,
    companyMatchConfidence: confidence,
    companyMatchReason: reason,
    companyMatchKey: key,
  };
}

function ambiguous(reason: string, key: string): MatchDecision {
  return {
    matchedCompanyRecordId: null,
    companyMatchStatus: "ambiguous",
    companyMatchConfidence: 60,
    companyMatchReason: reason,
    companyMatchKey: key,
  };
}

function groupBy(
  companies: CompanyCandidate[],
  keyFn: (company: CompanyCandidate) => string
) {
  const groups = new Map<string, CompanyCandidate[]>();
  for (const company of companies) {
    const key = keyFn(company);
    if (!key) {
      continue;
    }

    const existing = groups.get(key) ?? [];
    existing.push(company);
    groups.set(key, existing);
  }
  return groups;
}

function normalizeDomain(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname;
    return host.replace(/^www\./, "");
  } catch {
    return trimmed
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .trim();
  }
}

function normalizeLinkedInCompanyUrl(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  const withoutQuery = trimmed.split(/[?#]/)[0].replace(/\/+$/, "");
  return withoutQuery.replace(/^http:\/\//, "https://");
}

function extractEmailDomain(value: string | null | undefined) {
  const match = value?.trim().toLowerCase().match(/@([^@\s]+)$/);
  const domain = match?.[1] ? normalizeDomain(match[1]) : "";
  return isPersonalEmailDomain(domain) ? "" : domain;
}

function isPersonalEmailDomain(domain: string) {
  return [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "proton.me",
    "protonmail.com",
  ].includes(domain);
}

function nameCountryKey(
  companyName: string | null | undefined,
  country: string | null | undefined
) {
  const normalizedName = normalizeCompanyName(companyName);
  const normalizedCountry = normalizeCountry(country);
  return normalizedName && normalizedCountry
    ? `${normalizedName}::${normalizedCountry}`
    : "";
}

function countriesMatch(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const normalizedLeft = normalizeCountry(left);
  const normalizedRight = normalizeCountry(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeCountry(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function normalizeCompanyName(value: string | null | undefined) {
  return (
    value
      ?.toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(
        /\b(pte ltd|co ltd|llc|ltd|inc|corp|corporation|company|group|limited|ab|aps|as)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

function companyNameSimilarity(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const normalizedLeft = normalizeCompanyName(left);
  const normalizedRight = normalizeCompanyName(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  return diceCoefficient(normalizedLeft, normalizedRight);
}

function diceCoefficient(left: string, right: string) {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }

  let matches = 0;
  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0;
    if (count > 0) {
      matches += 1;
      rightCounts.set(bigram, count - 1);
    }
  }

  return (2 * matches) / (leftBigrams.length + rightBigrams.length);
}

function bigrams(value: string) {
  const padded = ` ${value} `;
  const result: string[] = [];
  for (let index = 0; index < padded.length - 1; index += 1) {
    result.push(padded.slice(index, index + 2));
  }
  return result;
}

