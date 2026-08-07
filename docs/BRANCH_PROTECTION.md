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
| Require a pull request before merging | on | No unreviewed change reaches `main` |
| Required approvals | 1 | Plan requirement |
| Dismiss stale approvals on new commits | on | An approval describes the code that was reviewed, not whatever lands after |
| Require conversation resolution | on | Review comments cannot be merged past silently |
| Require status checks to pass | on | The actual gate |
| Require branches to be up to date | on | Catches semantic conflicts CI would otherwise miss |
| Block force pushes | on | History on `main` stays auditable |
| Block deletions | on | — |
| Include administrators | on | A rule that the person most likely to be in a hurry can skip is not a rule |

## Which check to require

Require exactly one: **`CI required checks`** (the `ci-required` job).

It depends on `quality`, `migrations`, `e2e`, `docker` and `secret-scan`, and fails if any
of them failed, was cancelled, or was skipped. Requiring the aggregate rather than five
individual checks means adding a job later needs no change to the protection rule.

Two jobs are deliberately **not** required yet:

- **`CodeQL`** — needs a public repository, or GitHub Advanced Security on a private one.
  On a private repo without GHAS the upload step fails, which would block every merge.
  Watch one run go green first, then add it.
- **`Dependency review`** — pull-request only, and equally GHAS-dependent on private repos.
  Same rule: see it green, then require it.

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
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": true
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

Settings → Branches → Add branch ruleset (or classic branch protection rule) for `main`,
then tick the settings in the table above and add `CI required checks` under
"Require status checks to pass".

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
