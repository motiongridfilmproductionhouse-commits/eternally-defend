# Production Deployment Audit

Date: 2026-09-17
Author: SEO/growth execution session (Sprint 2, Phase 0)
Scope: determine whether `https://protectbyeterna.com` is in sync with
`origin/main`, and if not, why.

## 1. Repository state (verified via `git`)

- Remote: `https://github.com/motiongridfilmproductionhouse-commits/eternally-defend`
- `origin/main` HEAD at time of audit: **`2be19ba6f55656d3f15c056889e5dfbf86a48e26`**
- Recent history on `origin/main` (newest first):
  ```
  2be19ba6 Merge pull request #121 (feature/homepage-protected-engagements-redesign)
  9a445de2 Redesign homepage Protected Engagements section
  d771fea7 Merge pull request #120 (feature/eip-image-immunization-clean)
  f4a9dbbb Remove unresolved press-release placeholders from the public announcement
  f320cc6f QA fixes: heading hierarchy on pillar page, leaked internal note in FAQ
  dd990990 Add EIP (Image Immunization) pillar page and first four Newsroom articles
  ```
- This session has **fetch (read) access** to the remote but **no push access**
  ("access denied by the git proxy: ... is not in this session's authorized
  repository set"). All Sprint 1 and Sprint 2 work is delivered as git
  bundles, not pushed directly. The merges above (#120, #121) were applied by
  someone with real push access, outside this session — this audit only
  observes the result.

## 2. Production evidence (verified via live fetch, not cached assumptions)

Checked `https://protectbyeterna.com/` and related URLs directly, using
cache-busting query parameters and repeating checks minutes apart to rule out
a stale fetch-cache.

| Content from PR #120 (EIP) | Live? |
|---|---|
| `/image-immunization` returns 200, correct title "Eterna Image Immunization: Protect the Image Before Misuse Begins," correct H1 "Protect the Image Before Misuse Begins.", full body content, no placeholders | **YES — confirmed live** |
| `/sitemap.xml` includes all 5 EIP URLs (`/image-immunization` + 4 Newsroom articles) | **YES — confirmed live** |
| `/newsroom` shows the 4 new EIP guide cards alongside the original 3 | **YES — confirmed live** |

| Content from PR #121 (Protected Engagements redesign) | Live? |
|---|---|
| Homepage H2 reads "Protection for identities that operate in public." | **NO** — homepage still shows the pre-redesign heading, "Trusted to protect identities that operate in the public eye." |
| Homepage contains "CONFIDENTIAL BY DESIGN" label | **NO** — not found on the live page |
| Homepage contains "Standard image exposure" / "Eterna EIP protection flow" (the new lifecycle visual) | **NO** — not found on the live page |

This was checked three separate times with different cache-busting parameters
across this session, several minutes apart, with consistent results each
time. This rules out a simple 15-minute fetch-tool cache as the explanation.

**Finding: production is running a build that includes PR #120 but not PR
#121, even though both are merged into `origin/main` and PR #121 is the more
recent commit.** Production is behind `origin/main` by exactly one deploy.

## 3. Which of the seven possibilities does this match?

1. **Behind `main`** — yes, this is the primary finding. Production is
   serving a build from before commit `9a445de2` / `2be19ba6`.
2. Building from another branch — cannot confirm or rule out from repo
   inspection alone; no deploy config is committed to this repository (§4).
   Possible but not the leading hypothesis, since PR #120's content (merged
   to the same `main` branch, one merge earlier) *is* live — if production
   tracked a different branch entirely, PR #120 likely wouldn't be live
   either.
3. Connected to another repository — no evidence either way from this
   session; would require the hosting dashboard to confirm.
4. **Failing deployment — leading hypothesis.** The most consistent
   explanation for "PR #120 live, PR #121 (merged immediately after) not
   live" is that each merge to `main` triggers its own deploy, the deploy for
   #120 succeeded, and the deploy for #121 either failed a build/deploy step
   or was never triggered.
5. Serving cached output — ruled out by repeated, cache-busted, multi-minute-
   apart fetches all returning the same pre-#121 content consistently.
6. Using another hosting provider — `vite.config.ts` explicitly comments that
   the Nitro build targets **Cloudflare** by default (`nitro (build-only
   using cloudflare as a default target)`), and `vite build` generates
   `.output/server/wrangler.json` and `.wrangler/deploy/config.json` at build
   time. Strong evidence the intended host is Cloudflare Workers/Pages.
7. Otherwise out of sync — covered by finding #1/#4.

## 4. What this repository does *not* contain

- No `.github/workflows/` directory — no GitHub Actions CI/CD pipeline is
  defined in this repository.
- No committed `wrangler.toml` — the deploy config Nitro writes at build time
  lives only in the gitignored `.output/` directory, not in source control.
- No `deploy` script in `package.json` (only `dev`, `build`, `build:dev`,
  `preview`, lint/test scripts).

**Conclusion: this session cannot determine, from the repository alone,
whether deploys are automatic (e.g. a Cloudflare Pages "connect to GitHub"
integration configured outside this repo) or manual.** Given PR #120 clearly
made it to production and PR #121 (merged minutes later, per commit history)
did not, the most likely explanations, in order:

1. An auto-deploy hook exists and its run for the #121 merge failed (build
   error, timeout, quota) while the #120 run succeeded.
2. Deploys are triggered manually per merge, and whoever deployed #120 has
   not yet deployed #121 — simply "hasn't happened yet," not a failure.

Both are consistent with the evidence. This session has no Cloudflare
account access to distinguish between them.

## 5. REQUIRES OWNER ACTION

This session does not have credentials for whatever platform hosts
`protectbyeterna.com` (confirmed not Vercel — the connected Vercel account
has zero projects; likely Cloudflare Pages/Workers per §3.6, but no
Cloudflare access exists in this session).

**Exact remediation steps for the site owner:**

1. Open the Cloudflare dashboard (Pages or Workers, whichever this project
   uses) and find the deployment history for this project.
2. Look for a deployment tied to commit `9a445de2` (the Protected Engagements
   commit) or merge commit `2be19ba6`. Two outcomes:
   - **No such deployment exists at all** → auto-deploy on push to `main` is
     either not configured, or didn't fire for this merge. Manually trigger a
     deploy for the current `main` HEAD (`2be19ba6`), either via the
     dashboard's "Retry deployment"/"Create deployment" action, or by running
     `npx nitro deploy --prebuilt` from a checkout of `main` after running
     `npx vite build`.
   - **A deployment exists but shows a failed/errored status** → open its
     build log, fix whatever failed, and redeploy.
3. After redeploying, verify directly: fetch `https://protectbyeterna.com/`
   and confirm the homepage H2 reads "Protection for identities that operate
   in public." and the page contains "CONFIDENTIAL BY DESIGN".
4. Once confirmed, re-run Phase 1's verification matrix in full against the
   now-current production (see `docs/seo/PRODUCTION_ROUTE_VERIFICATION.md`).

No repository changes are required to fix this — this is a deploy/ops issue,
not a code issue. This session made no changes to fix it, since it has no
means to trigger or inspect the deploy itself.
