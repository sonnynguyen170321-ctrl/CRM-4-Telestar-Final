# V2 Activity Match Confidence Spec

Status: **v0.2 patched**  
Purpose: define how activity recap rows match Company, Contact, and LeadAssignment with predictable confidence tiers.

## 1. Confidence levels

```ts
export type ActivityMatchConfidence =
  | 'auto_match'
  | 'suggested_match'
  | 'needs_review'
  | 'no_match';
```

## 2. Auto-match conditions

Auto-match only when evidence is strong and non-conflicting.

Allowed auto-match signals:

- exact non-generic contact email,
- exact contact LinkedIn profile,
- exact company canonical domain with no conflict,
- exact existing LeadAssignment for selected Project + ICP context.

Auto-match is blocked when:

- email is generic,
- domain has parent/subsidiary/shared-domain conflict,
- project context is missing,
- multiple strong candidates exist,
- row has conflicting company/contact evidence.

## 3. Suggested-match conditions

Suggested match means the system has a likely candidate but a human should confirm before applying.

Examples:

- normalized company name + contact full name within same Project,
- company domain exact + contact name only,
- phone + name + company context,
- fuzzy company name with high similarity and same Project.

## 4. Needs-review conditions

Needs review means the row should not be applied automatically.

Examples:

- fuzzy company name only,
- contact name only,
- generic email only,
- no Project context,
- multiple possible companies/contacts,
- same domain appears to represent multiple brands/subsidiaries,
- row outcome suggests status change but LeadAssignment is unclear.

## 5. No-match conditions

No match means the resolver found no useful candidate.

The UI should offer:

- create company/contact from recap row,
- link to existing manually,
- dismiss as non-actionable,
- keep unresolved.

## 6. No-project-context fallback

Activity imports should ideally be scoped to ClientAccount + Project. If Project is not selected:

1. Resolve high-confidence Company/Contact identities only.
2. Do not create scored LeadAssignments.
3. Store activity as unassigned/import-candidate or create ManagerReviewItem.
4. Require manager to choose Project/ICP before the activity can update project-specific reporting.

## 7. Match output contract

```ts
export type ActivityMatchResult = {
  companyMatch: IdentityMatchResult;
  contactMatch?: IdentityMatchResult;
  leadAssignmentMatch?: IdentityMatchResult;
  overallConfidence: ActivityMatchConfidence;
  reasonCodes: string[];
  managerReviewRequired: boolean;
  suggestedActions: Array<
    | 'link_existing'
    | 'create_company'
    | 'create_contact'
    | 'create_lead_assignment'
    | 'dismiss'
    | 'select_project_context'
  >;
};
```

## 8. Manager trust rule

False positive matches are worse than unresolved rows. Pilot should prefer review over silent incorrect linking.

## 9. Metrics

Track:

- auto_match_rate,
- suggested_match_rate,
- needs_review_rate,
- no_match_rate,
- false_match_reports,
- manager_resolution_time,
- create_from_recap_count.
