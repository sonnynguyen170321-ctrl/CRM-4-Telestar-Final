# Branch protection on `main`

CI enforces nothing on its own. A red run is only advisory until `main` is configured to
require it — that configuration lives in GitHub, not in this repository, so it is not
covered by any test and has to be applied by hand once.

> **This changes how the repo is worked on.** Every task in the pre-domain hardening plan
> so far has been committed on a branch and merged straight into `main` locally. Once
> "require a pull request" is on, that stops working: `git push` to `main` is rejected and
> changes have to go through a PR. That is the point of the task, but it is a real change
> to the day-to-day loop — decide deliberately, don't just paste the commands.

## What to require

| Setting | Value | Why |
| --- | --- | --- |
| Require a pull request before merging | on | Every change to `main` arrives as a reviewable, CI-gated unit |
| Required approvals | **0** | See below — 1 would make `main` unmergeable |
| Dismiss stale approvals on new commits | on | An approval describes the code that was reviewed, not whatever lands after |
| Require conversation resolution | on | Review comments cannot be merged past silently |
| Require status checks to pass | on | The actual gate |
| Require branches to be up to date | on | Catches semantic conflicts CI would otherwise miss |
| Block force pushes | on | History on `main` stays auditable |
| Block deletions | on | — |
| Include administrators | on | A rule that the person most likely to be in a hurry can skip is not a rule |

### Why 0 approvals, not 1

The plan text says "≥1 approval". That is written for a team, and applying it literally to
this repository would break it: **GitHub does not let you approve your own pull request.**
With 1 required approval *and* administrators included, a single maintainer cannot merge
anything, ever — the only escape is to weaken `enforce_admins`, at which point the rule is
advisory for the one person most able to bypass it.

So the approval count is 0 and administrators stay included. What actually protects `main`
is unchanged and is now absolute for everybody:

- no direct pushes — every change goes through a pull request;
- no merge while `CI required checks` is red;
- no force pushes, no branch deletion.

Raise this to 1 the day a second person gets write access. That is a one-field change.

## Which check to require

Require exactly one: **`CI required checks`** (the `ci-required` job).

It depends on `quality`, `migrations`, `e2e`, `docker` and `secret-scan`, and fails if any
of them failed, was cancelled, or was skipped. Requiring the aggregate rather than five
individual checks means adding a job later needs no change to the protection rule.

Two jobs are deliberately **not** required yet:

- **`CodeQL`** and **`Dependency review`** — the repository is **public**
  (`visibility: "public"`, confirmed via the API on 2026-08-07), so both are available and
  should work. They are still held back from the required list until a run has been seen
  green, because a required check that has never passed blocks every merge and the failure
  looks like your code rather than like configuration. Add them once green.

## Order of operations

Turning protection on blocks direct pushes to `main` **immediately**, including yours. So
anything already sitting on your local `main` has to reach the remote first, or it has to
be re-landed through a pull request afterwards.

1. Push whatever is already on local `main`. This is the last direct push.
2. Push every unmerged work branch.
3. Apply the ruleset (below).
4. Land the remaining work through pull requests — the first one doubles as the
   verification that the gate works.

## Applying it

### With the `gh` CLI

`gh` is **not installed on this machine** — `gh auth status` returns `command not found`.
Install it (`winget install GitHub.cli`), run `gh auth login`, then:

```bash
gh api -X PUT repos/sonnynguyen170321-ctrl/crm-4-telestar-final/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI required checks"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true
  },
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON
```

Also enable private vulnerability reporting while you are there — Task 9 needs it:

```bash
gh api -X PUT repos/sonnynguyen170321-ctrl/crm-4-telestar-final/private-vulnerability-reporting
```

### In the web UI

**Settings → Rules → Rulesets → New ruleset → New branch ruleset.**

| Field | Value |
| --- | --- |
| Ruleset name | `main protection` |
| Enforcement status | **Active** (not "Evaluate" — that only reports) |
| Bypass list | **leave empty** — this is what "include administrators" means for rulesets |
| Target branches | Add target → **Include default branch** |

Then tick, under **Branch rules**:

- **Restrict deletions**
- **Block force pushes**
- **Require a pull request before merging**
  - Required approvals: **0**
  - Dismiss stale pull request approvals when new commits are pushed: on
  - Require conversation resolution before merging: on
- **Require status checks to pass**
  - Require branches to be up to date before merging: on
  - Add checks → search `CI required checks` → select it

Leave *Require signed commits*, *Require linear history* and *Require deployments* off —
none of them are in the plan and each has its own failure mode.

Save with **Create**.

> The classic "Branches → Add branch protection rule" screen also works and has the same
> fields, plus an explicit "Do not allow bypassing the above settings" checkbox which must
> be **ticked** (it is the classic UI's name for including administrators). Rulesets are
> the current mechanism and are what the steps above describe.

> **`CI required checks` will only appear in the search box once it has reported at least
> once on this repository.** If the list is empty, push a branch and open a pull request
> first, let CI run, then come back and add it. Adding a never-seen check name by typing it
> is possible but easy to typo, and a required check that never reports blocks every merge.

## Verifying it works

The plan asks for five specific proofs. Do them on a throwaway branch and PR:

| Break this | Expected |
| --- | --- |
| Add `const x: number = 'nope'` to any `.ts` | `quality` fails on `tsc`, merge blocked |
| Make a Vitest assertion false | `quality` fails, merge blocked |
| Break a Playwright selector | `e2e` fails, artifacts uploaded, merge blocked |
| Add `RUN exit 1` to the Dockerfile | `docker` fails, merge blocked |
| Any of the above, then check GHCR | no new image tag published |
| `git push origin main` directly | rejected by the ruleset |

The publishing proof matters most and is the one that is easy to get wrong: image
publishing moved from "on push to `main`" to `workflow_run` on **CI concluding
successfully**, so a failing commit on `main` now produces no image at all.
