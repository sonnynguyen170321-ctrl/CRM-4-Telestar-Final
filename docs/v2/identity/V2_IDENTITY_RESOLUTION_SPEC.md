# V2 Identity Resolution Spec

Status: **v0.2 patched / ready for human lock before V2.7**  
Applies to: company upload, contact upload, activity recaps, LeadAssignment creation, suppression, scoring persistence, reporting.

## 1. Purpose

Identity resolution decides whether an incoming row refers to an existing Company, Contact, and LeadAssignment or should create a new entity / manager review item.

This must be defined once and reused everywhere. Company upload and activity recap must not each invent their own matching logic.

## 2. Source-of-truth boundary

- Company identity belongs to Company.
- Contact identity belongs to Contact + ContactIdentifier.
- Project/ICP-specific state belongs to LeadAssignment.
- Activity recap rows suggest/match records but do not silently mutate final lead status.

## 3. Company canonical domain

### 3.1 Default uniqueness

Canonical domain is unique per Organization.

```txt
unique(org_id, canonical_domain)
```

This default prevents duplicate companies across accounts/projects and allows shared enrichment/scoring history.

### 3.2 Canonicalization rules

Normalize company website/domain as follows:

1. Trim whitespace.
2. Lowercase.
3. Remove scheme: `http://`, `https://`.
4. Remove `www.` prefix.
5. Remove path/query/hash.
6. Remove trailing slash.
7. Extract registrable domain when possible.
8. Preserve original URL separately for audit/debug.

Examples:

| Input | canonical_domain | notes |
|---|---|---|
| `https://www.Example.com/about` | `example.com` | auto |
| `http://app.example.com/login` | `example.com` + subdomain flag | review if product/app subdomain may matter |
| `https://careers.example.com` | `example.com` + careers flag | weak evidence, not separate company by default |

### 3.3 Parent/subsidiary/shared-domain handling

Do **not** auto-merge when:

- same domain appears with clearly different subsidiary/legal entity,
- same holding company owns multiple brands,
- franchise/network uses one shared domain,
- marketplace/vendor page is submitted instead of company site,
- only LinkedIn/social page exists,
- subdomain looks like a separate product/business unit.

Instead create `ManagerReviewItem` with reason:

```txt
company_domain_conflict
possible_parent_subsidiary
shared_domain_ambiguous
```

## 4. Company match order

```txt
1. exact canonical_domain within org → auto_match unless conflict flag
2. normalized company name within selected ClientAccount/Project → suggested_match or auto_match only if very strong
3. fuzzy normalized name → suggested_match only
4. no match → create new company candidate or manager review depending on ingestion type
```

Fuzzy name alone must never auto-merge.

## 5. Contact identity

### 5.1 ContactIdentifier model

Contact should not rely on flat email/phone columns.

```txt
ContactIdentifier
- contact_id
- org_id
- type: email | phone | linkedin | other
- normalized_value
- raw_value
- is_generic
- is_valid
- validity_status: valid | invalid | bounced | suppressed | unknown
- source
- last_validated_at
```

### 5.2 Email uniqueness decision

Non-generic email is unique per Organization:

```txt
unique(org_id, type='email', normalized_value) where is_generic=false
```

Generic email is not unique identity evidence and cannot auto-merge contacts:

```txt
info@
sales@
support@
hello@
contact@
admin@
team@
marketing@
```

Generic emails may be stored as identifiers but only provide weak evidence.

### 5.3 LinkedIn uniqueness

LinkedIn profile URL is unique per Organization after normalization.

```txt
unique(org_id, type='linkedin', normalized_value)
```

Company LinkedIn pages are not contact identifiers.

### 5.4 Phone uniqueness

Phone numbers are weaker than email/LinkedIn because company main lines, switchboards, and shared SDR call numbers are common.

Recommended pilot behavior:

- exact mobile-like phone + same name/context → suggested_match or auto_match if very strong,
- phone alone → suggested_match only,
- known company main line → weak evidence only.

## 6. Contact match order

```txt
1. exact non-generic email within org → auto_match
2. exact LinkedIn profile within org → auto_match
3. exact phone + name + company context → suggested_match / possible auto_match if policy allows
4. full name + company auto_match → suggested_match
5. fuzzy name only → needs_review
6. no match → create candidate or manager review
```

## 7. LeadAssignment resolution

LeadAssignment is contextual:

```txt
Company × optional Contact × Project × ICP Version
```

Resolution order:

```txt
1. resolve Company
2. resolve Contact if contact evidence exists
3. resolve Project/ICP context
4. find or create LeadAssignment for that context
```

No project context fallback:

- If no project selected during import, do not create project-specific LeadAssignment.
- Create/resolve Company and Contact only if high confidence.
- Create `ManagerReviewItem` or import staging item requiring project/ICP selection before scoring.
- Activity rows without project context may be stored as unassigned activity candidates but must not mutate pipeline/review state.

## 8. Activity recap integration

Activity recap matching uses the same identity resolver.

High confidence:

```txt
exact contact email
exact contact LinkedIn
exact company canonical domain
```

Medium confidence:

```txt
company name + contact name + same project
company domain + contact name but no email
```

Low confidence:

```txt
fuzzy company only
contact name only
no domain/email
```

Low-confidence matches create manager review items, not automatic linked activities.

## 9. Create-from-recap action

Managers need a fast path for early recap imports:

```txt
Create company/contact from recap row
```

Rules:

- action must show raw row + normalized row,
- manager chooses project/ICP context if needed,
- created records reference source ingestion row,
- action is audited,
- never silently creates duplicate contact from generic email alone.

## 10. Match result shape

Draft TypeScript contract for V2.2:

```ts
export type MatchConfidence = 'auto_match' | 'suggested_match' | 'needs_review' | 'no_match';

export type MatchReasonCode =
  | 'exact_canonical_domain'
  | 'exact_non_generic_email'
  | 'exact_linkedin_profile'
  | 'normalized_name_context_match'
  | 'fuzzy_name_only'
  | 'generic_email_only'
  | 'domain_conflict'
  | 'no_project_context'
  | 'no_match';

export type IdentityMatchResult<TId extends string = string> = {
  confidence: MatchConfidence;
  matchedId?: TId;
  candidateIds?: TId[];
  reasonCode: MatchReasonCode;
  score: number; // 0..1, not a qualification score
  requiresManagerReview: boolean;
  notes: string[];
};
```

## 11. Guardrails for Codex

Codex must not:

- create schema before this spec is locked,
- auto-merge fuzzy name matches,
- treat generic emails as strong identity,
- create LeadAssignment without project/ICP context unless a future ADR explicitly allows it,
- dynamically read V1 runtime tables,
- create parent/subsidiary rules beyond review flags during pilot.

## 12. Remaining human confirmations

The v0.2 default decisions are locked unless the user overrides them:

- Company canonical domain unique per Organization.
- Non-generic contact email unique per Organization.
- Generic emails weak only.
- LinkedIn profile unique per Organization.
- Fuzzy name alone never auto-merges.
- No-project context does not create scored LeadAssignment.
