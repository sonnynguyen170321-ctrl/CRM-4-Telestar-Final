# V2 Canonical ICP Registry

Status: **V2.ICP-BENCH0R docs-only repair**
Runtime status: **registry docs only; no schema or benchmark runner**

## 1. Purpose

The canonical ICP registry maps benchmark rows and source sub-pipelines to reviewed ICP definitions. It prevents weak benchmark output from being treated as production truth.

## 2. Registry Entry Contract

```ts
type CanonicalIcpRegistryEntry = {
  icpId: string;
  clientAccount: string;
  projectName?: string;
  icpName: string;
  icpTrack: string;

  owner: string;
  version: string;
  status: "DRAFT" | "REVIEWED" | "PUBLISHED";

  lastUpdated: string;
  sourceNotes: string;

  mappedSubPipelines: string[];

  benchmarkPolicy:
    | "INCLUDE"
    | "EXCLUDE_UNMAPPED"
    | "REVIEW_ONLY";

  requiredEvidenceForFinalQualification: {
    explicitGeo: boolean;
    employeeSize: boolean;
    personaTitle: boolean;
    websiteReachable?: boolean;
  };

  blocksFinalQualificationFromCompanyOnlyEvidence: boolean;
};
```

## 3. Baseline Canonical ICP Entries

| icpId | clientAccount | icpName | icpTrack | status | benchmarkPolicy | mappedSubPipelines | explicitGeo | employeeSize | personaTitle | blocksCompanyOnlyFinalQualification | sourceNotes |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `icp-1cloudhub-sg-cloud-transformation` | 1CloudHub | 1CloudHub Singapore Cloud / Transformation | Cloud transformation | REVIEWED | INCLUDE | `1C`, `1CloudHub` | true | false | true | true | Baseline persona-sensitive cloud ICP |
| `icp-betterhr-vn-hr-payroll` | BetterHR | BetterHR Vietnam HR / Payroll Software | HR payroll software | REVIEWED | INCLUDE | `BetterHR` | true | true | true | true | Baseline Vietnam HR/payroll ICP |
| `icp-chainwire-crypto` | Chainwire | Chainwire Crypto | Crypto PR | REVIEWED | INCLUDE | `Chainwire`, `Chainwire Crypto` | true | false | true | true | Multi-ICP candidate with Chainwire Cyber |
| `icp-chainwire-cyber` | Chainwire | Chainwire Cyber | Cybersecurity PR | REVIEWED | INCLUDE | `Chainwire`, `Chainwire Cyber` | true | true | true | true | Multi-ICP candidate with Chainwire Crypto |
| `icp-cyberstash` | Cyberstash | Cyberstash | Cybersecurity | REVIEWED | INCLUDE | `Cyberstash` | true | true | true | true | Baseline cybersecurity ICP |
| `icp-fingermind` | FingerMind | FingerMind | Digital product / consulting | REVIEWED | INCLUDE | `FingerMind` | true | false | true | true | Persona-sensitive ICP |
| `icp-stratova-cxo` | Stratova | Stratova CXO | CXO advisory | REVIEWED | INCLUDE | `Stratova`, `Stratova CXO` | true | true | true | true | Multi-ICP candidate with GCP event |
| `icp-stratova-gcp-event` | Stratova | Stratova GCP Event | GCP event | REVIEWED | INCLUDE | `Stratova`, `Stratova GCP Event` | true | true | true | true | Multi-ICP candidate with CXO |
| `icp-telestar-sdr-outsourcing` | TeleStar | TeleStar SDR Outsourcing | SDR outsourcing | DRAFT | REVIEW_ONLY |  | true | true | true | true | Known ICP; benchmark mapping pending |
| `icp-antsomi` | Antsomi | Antsomi | Marketing CDP / customer data | DRAFT | REVIEW_ONLY |  | true | true | true | true | Known ICP; benchmark mapping pending |
| `icp-vedubox` | Vedubox | Vedubox | Edtech / learning platform | DRAFT | REVIEW_ONLY |  | false | true | true | true | Known ICP; benchmark mapping pending |

For DRAFT rows with unknown source mappings:

```txt
mappedSubPipelines: []
benchmarkPolicy: REVIEW_ONLY
sourceNotes: "Known ICP; benchmark mapping pending"
```

## 4. Explicit Unmapped Exclusions

| sourceSubPipeline | canonicalIcpId | benchmarkPolicy | benchmarkSplit |
| --- | --- | --- | --- |
| GHS | null | EXCLUDE_UNMAPPED | UNMAPPED_EXCLUDED |
| FastNetMon | null | EXCLUDE_UNMAPPED | UNMAPPED_EXCLUDED |
| Choys | null | EXCLUDE_UNMAPPED | UNMAPPED_EXCLUDED |
| Teamflect | null | EXCLUDE_UNMAPPED | UNMAPPED_EXCLUDED |
| GMO | null | EXCLUDE_UNMAPPED | UNMAPPED_EXCLUDED |
| N7 | null | EXCLUDE_UNMAPPED | UNMAPPED_EXCLUDED |
| SoraSo | null | EXCLUDE_UNMAPPED | UNMAPPED_EXCLUDED |
| ZetNet_Michael | null | EXCLUDE_UNMAPPED | UNMAPPED_EXCLUDED |

Excluded rows must not count toward scoring agreement, qualification rate, false positives, or false negatives.

## 5. Registry Rules

- Human final label is benchmark truth.
- AI agent output is advisory only.
- Deterministic assessment is a candidate assessment.
- Persona-sensitive ICPs must not produce final `QUALIFIED` from company-only evidence.
- Multi-ICP expansion is deferred until explicitly scoped.
- Registry changes must be reviewed before benchmark scripts consume them.
