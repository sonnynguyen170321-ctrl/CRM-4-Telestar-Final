import type {
  IdentityCompanyCandidate,
  IdentityContactCandidate,
  IdentityResolutionInput,
  IdentityResolutionReason,
  IdentityResolutionResult,
} from "../types";

export type SampleIdentityResolverFixture = {
  name: string;
  input: IdentityResolutionInput;
  expected: Pick<
    IdentityResolutionResult,
    "kind" | "confidence" | "companyId" | "contactId"
  > & {
    reasons: IdentityResolutionReason[];
  };
};

const acmeCompany = {
  id: "company-acme",
  organizationId: "org-1",
  accountId: "account-1",
  projectIds: ["project-1"],
  canonicalDomain: "acme.example",
  website: "https://acme.example",
  normalizedName: "acme software",
  displayName: "Acme Software",
  aliases: ["Acme"],
} satisfies IdentityCompanyCandidate;

const acmeContact = {
  id: "contact-ada",
  organizationId: "org-1",
  companyId: "company-acme",
  email: "ada@acme.example",
  normalizedEmail: "ada@acme.example",
  linkedinUrl: "https://linkedin.com/in/ada-acme",
  normalizedLinkedinUrl: "linkedin.com/in/ada-acme",
} satisfies IdentityContactCandidate;

const baseInput = {
  context: {
    organizationId: "org-1",
    accountId: "account-1",
    projectId: "project-1",
  },
  candidates: {
    companies: [acmeCompany],
    contacts: [acmeContact],
  },
} satisfies Omit<IdentityResolutionInput, "row">;

const vietnameseCompany = {
  id: "company-vn",
  organizationId: "org-1",
  accountId: "account-vn",
  projectIds: ["project-vn"],
  normalizedName: "du lieu sao bac",
  displayName: "Du Lieu Sao Bac",
  aliases: ["Sao Bac"],
} satisfies IdentityCompanyCandidate;

const vietnameseBaseInput = {
  context: {
    organizationId: "org-1",
    accountId: "account-vn",
    projectId: "project-vn",
  },
  candidates: {
    companies: [vietnameseCompany],
    contacts: [],
  },
} satisfies Omit<IdentityResolutionInput, "row">;

export const SAMPLE_IDENTITY_RESOLVER_FIXTURES: SampleIdentityResolverFixture[] = [
  {
    name: "exact canonical company domain",
    input: {
      ...baseInput,
      row: {
        canonicalDomain: "https://www.acme.example/path",
        companyName: "Different display",
      },
    },
    expected: {
      kind: "exact_company",
      confidence: 0.95,
      companyId: "company-acme",
      reasons: ["company_domain_exact"],
    },
  },
  {
    name: "exact contact email only after resolved company domain",
    input: {
      ...baseInput,
      row: {
        website: "https://acme.example",
        contactEmail: "ada@acme.example",
      },
    },
    expected: {
      kind: "exact_contact",
      confidence: 0.98,
      companyId: "company-acme",
      contactId: "contact-ada",
      reasons: ["company_domain_exact", "contact_email_exact"],
    },
  },
  {
    name: "exact contact linkedin only after resolved company domain",
    input: {
      ...baseInput,
      row: {
        canonicalDomain: "acme.example",
        contactLinkedinUrl: "https://www.linkedin.com/in/ada-acme/",
      },
    },
    expected: {
      kind: "exact_contact",
      confidence: 0.98,
      companyId: "company-acme",
      contactId: "contact-ada",
      reasons: ["company_domain_exact", "contact_linkedin_exact"],
    },
  },
  {
    name: "normalized company name within account project context",
    input: {
      ...baseInput,
      row: {
        companyName: "Acme Software",
      },
    },
    expected: {
      kind: "exact_company",
      confidence: 0.88,
      companyId: "company-acme",
      reasons: ["company_name_exact_in_context"],
    },
  },
  {
    name: "same company name outside account project context ignored",
    input: {
      context: {
        organizationId: "org-1",
        accountId: "account-1",
        projectId: "project-1",
      },
      row: {
        companyName: "Acme Software",
      },
      candidates: {
        companies: [
          {
            ...acmeCompany,
            id: "company-acme-wrong-context",
            accountId: "account-2",
            projectIds: ["project-2"],
          },
        ],
        contacts: [],
      },
    },
    expected: {
      kind: "none",
      confidence: 0,
      reasons: ["context_mismatch_ignored", "no_usable_identity_evidence"],
    },
  },
  {
    name: "fuzzy company name returns candidate only",
    input: {
      ...baseInput,
      row: {
        companyName: "Acme Software Platform",
      },
    },
    expected: {
      kind: "candidate",
      confidence: 0.62,
      companyId: "company-acme",
      reasons: ["fuzzy_company_name_candidate_only"],
    },
  },
  {
    name: "no usable identity evidence returns none",
    input: {
      ...baseInput,
      row: {},
    },
    expected: {
      kind: "none",
      confidence: 0,
      reasons: ["no_usable_identity_evidence"],
    },
  },
  {
    name: "cross tenant exact domain ignored",
    input: {
      context: {
        organizationId: "org-1",
        accountId: "account-1",
        projectId: "project-1",
      },
      row: {
        canonicalDomain: "acme.example",
      },
      candidates: {
        companies: [
          {
            ...acmeCompany,
            organizationId: "org-2",
          },
        ],
        contacts: [],
      },
    },
    expected: {
      kind: "none",
      confidence: 0,
      reasons: ["tenant_mismatch_ignored", "no_usable_identity_evidence"],
    },
  },
  {
    name: "public email domain blocked from company identity",
    input: {
      ...baseInput,
      row: {
        contactEmail: "founder@gmail.com",
      },
    },
    expected: {
      kind: "none",
      confidence: 0,
      reasons: ["blocked_public_email_domain", "no_usable_identity_evidence"],
    },
  },
  {
    name: "generic email cannot exact contact",
    input: {
      context: {
        organizationId: "org-1",
        accountId: "account-1",
        projectId: "project-1",
      },
      row: {
        canonicalDomain: "acme.example",
        contactEmail: "info@acme.example",
      },
      candidates: {
        companies: [acmeCompany],
        contacts: [
          {
            ...acmeContact,
            id: "contact-info",
            email: "info@acme.example",
            normalizedEmail: "info@acme.example",
            isGenericEmail: true,
          },
        ],
      },
    },
    expected: {
      kind: "exact_company",
      confidence: 0.95,
      companyId: "company-acme",
      reasons: ["blocked_generic_contact_email", "company_domain_exact"],
    },
  },
  {
    name: "vietnamese legal prefix diacritics casing normalize to exact name",
    input: {
      context: {
        organizationId: "org-1",
        accountId: "account-vn",
        projectId: "project-vn",
      },
      row: {
        companyName: "Công Ty TNHH Dữ Liệu Sao Bắc",
      },
      candidates: {
        companies: [
          {
            id: "company-vn",
            organizationId: "org-1",
            accountId: "account-vn",
            projectIds: ["project-vn"],
            normalizedName: "du lieu sao bac",
            displayName: "Du Lieu Sao Bac",
          },
        ],
        contacts: [],
      },
    },
    expected: {
      kind: "exact_company",
      confidence: 0.88,
      companyId: "company-vn",
      reasons: ["company_name_exact_in_context"],
    },
  },
  {
    name: "vietnamese CP legal prefix normalizes to exact alias",
    input: {
      ...vietnameseBaseInput,
      row: {
        companyName: "Công ty CP Sao Bắc",
      },
    },
    expected: {
      kind: "exact_company",
      confidence: 0.88,
      companyId: "company-vn",
      reasons: ["company_name_exact_in_context"],
    },
  },
  {
    name: "vietnamese co phan legal prefix normalizes to exact name",
    input: {
      ...vietnameseBaseInput,
      row: {
        companyName: "Công ty Cổ Phần Dữ Liệu Sao Bắc",
      },
    },
    expected: {
      kind: "exact_company",
      confidence: 0.88,
      companyId: "company-vn",
      reasons: ["company_name_exact_in_context"],
    },
  },
  {
    name: "vietnamese decomposed unicode normalizes like NFC",
    input: {
      ...vietnameseBaseInput,
      row: {
        companyName: "Công ty Cổ Phần Dữ Liệu Sao Bắc".normalize("NFD"),
      },
    },
    expected: {
      kind: "exact_company",
      confidence: 0.88,
      companyId: "company-vn",
      reasons: ["company_name_exact_in_context"],
    },
  },

  // ── Contact resolution independent of company domain ──
  // These fixtures assert that the contact is found even when the company
  // is matched by name (not domain), fuzzy-matched, or entirely missing.
  // Before the P0 fix, the contact was only searched inside the
  // domain-match block, so these would all return without a contactId,
  // leading to duplicate V2Contact creation during the upsert phase.

  {
    name: "contact email resolves even when company matched by name only",
    input: {
      context: {
        organizationId: "org-1",
        accountId: "account-1",
        projectId: "project-1",
      },
      row: {
        companyName: "Acme Software",
        contactEmail: "ada@acme.example",
      },
      candidates: {
        companies: [
          {
            // Company without a domain — can only match by normalized name
            id: "company-acme-no-domain",
            organizationId: "org-1",
            accountId: "account-1",
            projectIds: ["project-1"],
            normalizedName: "acme software",
            displayName: "Acme Software",
          },
        ],
        contacts: [acmeContact],
      },
    },
    expected: {
      kind: "exact_contact",
      confidence: 0.98,
      companyId: "company-acme-no-domain",
      contactId: "contact-ada",
      reasons: ["contact_email_exact", "company_name_exact_in_context"],
    },
  },
  {
    name: "contact linkedin resolves even when company is fuzzy matched",
    input: {
      ...baseInput,
      row: {
        companyName: "Acme Software Platform",
        contactLinkedinUrl: "https://www.linkedin.com/in/ada-acme/",
      },
    },
    expected: {
      kind: "candidate",
      confidence: 0.62,
      companyId: "company-acme",
      contactId: "contact-ada",
      reasons: ["contact_linkedin_exact", "fuzzy_company_name_candidate_only"],
    },
  },
  {
    name: "contact email resolves even when no company matches at all",
    input: {
      context: {
        organizationId: "org-1",
      },
      row: {
        companyName: "Totally Unknown Corp",
        contactEmail: "ada@acme.example",
      },
      candidates: {
        companies: [],
        contacts: [acmeContact],
      },
    },
    expected: {
      kind: "exact_contact",
      confidence: 0.98,
      // The resolver returns the contact's KNOWN employer so the upsert links the lead to
      // it instead of creating a duplicate company from the unmatched row name.
      companyId: "company-acme",
      contactId: "contact-ada",
      reasons: ["contact_email_exact"],
    },
  },
];
