# Auth / Onboarding Index Control — Decision Record

Date: 2026-09-17
Author: SEO/growth execution session (Sprint 2, Phase 0)
Scope: `/auth` and `/onboarding`, and the interaction between `robots.txt`
and per-page `noindex` meta tags on this site.

## The problem

Sprint 1 added `<meta name="robots" content="noindex, nofollow">` to both
`/auth` and `/onboarding`, intending to keep them out of Google's index.
At the same time, `public/robots.txt` (unchanged by Sprint 1) still
contained:

```
Disallow: /auth
Disallow: /onboarding
```

These two controls fight each other. `Disallow` in `robots.txt` tells a
compliant crawler not to **fetch** the page at all. A crawler that never
fetches a page never reads anything in its `<head>`, including a `noindex`
meta tag. So a disallowed-and-noindexed page's `noindex` tag is inert —
Google (or any other engine) simply never sees it.

This is not a theoretical concern for this session. Attempting to fetch
`https://protectbyeterna.com/auth` and `https://protectbyeterna.com/onboarding`
via this session's `WebFetch` tool — which respects `robots.txt`, the same
way a compliant search crawler does — failed both times with a
`ROBOTS_DISALLOWED` error. That is direct, reproducible confirmation that
robots.txt is currently blocking access to these two pages, on production,
right now.

There's a second, separate risk if a `Disallow`'d page is linked from
elsewhere (internal nav, an external site, a bookmark): Google can still
list a disallowed URL in search results — as a bare URL with no title or
snippet, sourced from the link text and surrounding context alone — because
`Disallow` prevents crawling, not indexing of the URL as an entry. A
"Client Sign In" link that appears in the global navigation on every page
of the site is exactly the kind of internal link that produces this
outcome: a bare, ugly, low-information `/auth` result entry that competes
with — or even outranks, if it accumulates enough internal link equity —
the actual brand homepage result for a "Eterna Sentinel" or "Eterna AI"
brand-name search. That is the specific outcome this decision is meant to
prevent.

## Is `/auth` / `/onboarding` actually confidential content?

No. Both are public entry screens:

- `/auth` is the sign-in / sign-up form itself — the same kind of page as
  any SaaS product's login screen. It contains no client data, no account
  contents, and no confidential business information. It's reachable by
  anyone who navigates to it, logged in or not.
- `/onboarding` is gated (`beforeLoad` redirects to `/auth` if there's no
  authenticated session), but the route shell itself — before
  authentication resolves — is not a page whose existence needs to be
  hidden from crawlers. It reveals nothing about any client, account, or
  confidential process merely by being crawlable; an unauthenticated
  crawler that requests it is redirected before any real content renders.

Neither page meets the bar for "must not be exposed merely for SEO
convenience" — they are not authenticated dashboards, not client records,
and not confidential operational pages. The `agent`, `agent-admin`,
`agent-assessment`, `partner`, `verify/`, and `face-handoff/` paths, which
remain `Disallow`'d in `robots.txt`, are a different category (internal /
partner-facing tooling and one-time verification links) and are
intentionally left blocked — this decision does not change those.

## Decision

**Allow crawling of `/auth` and `/onboarding`; keep `noindex, follow` (not
`noindex, nofollow`) as the meta directive; remove both paths from
`robots.txt`'s `Disallow` list.**

Concretely, this session made three changes on this branch
(`feature/seo-growth-sprint-2`):

1. `public/robots.txt` — removed `Disallow: /auth` and
   `Disallow: /onboarding`, with a comment pointing back to this document.
2. `src/routes/auth.tsx` — changed the robots meta from
   `"noindex, nofollow"` to `"noindex, follow"`.
3. `src/routes/onboarding.tsx` — same change, `"noindex, nofollow"` to
   `"noindex, follow"`.

### Why `noindex, follow` and not `noindex, nofollow`

`noindex` alone is sufficient to keep the page itself out of the index —
that's the actual goal. `nofollow` additionally tells crawlers not to pass
equity through the links found on that page. Since `/auth` and
`/onboarding` sit in the normal site chrome (same header/footer/nav as
every other page) and don't contain any link a crawler shouldn't follow,
there's no reason to also block link-following from them — doing so only
throws away crawl signal for no benefit. `follow` is the more precise,
less destructive choice given the actual goal is "don't index this
specific URL," not "treat this page as a dead end."

### Why this is the correct fix rather than the reverse (keep `Disallow`, drop `noindex`)

The alternative — keep `robots.txt` blocking these paths and remove the
`noindex` tag — would leave the exact bare-URL-in-search-results risk
described above unaddressed, since `Disallow` does nothing to prevent a
disallowed URL from appearing as a link-only search result. Allowing crawl
access is what lets Google actually read the `noindex` directive and honor
it by leaving the URL out of the index entirely (not even as a bare link).

## Goal this satisfies

The explicit goal for this decision: **"Client Sign In" must not become
Eterna's principal Google brand result** for searches like "Eterna
Sentinel" or "Eterna AI." With `noindex, follow` actually reachable and
readable by crawlers (once `robots.txt` stops blocking it), `/auth` and
`/onboarding` should drop out of the index entirely over time, leaving the
homepage — the actually optimized, schema-carrying, canonical brand page —
as the unambiguous top result for brand-name queries.

## What this does not change

- `/agent`, `/agent-admin`, `/agent-assessment`, `/partner`, `/verify/`,
  `/face-handoff/`, `/api/` remain `Disallow`'d in `robots.txt`. Those are
  not public entry screens in the same sense and are left blocked as
  before.
- `/partner-apply` remains explicitly `Allow`'d (unchanged from before this
  edit) — it's a public partner-signup landing page, not an authenticated
  area.
- No change to actual authentication behavior, session handling, or access
  control on either route. This is a crawler-visibility change only; the
  pages still require real credentials to reach anything behind them.

## Verification once deployed

This is a `SEARCH OBSERVATION` vs `INDEXING CONFIRMATION` distinction
(Phase 2 of this sprint): the only way to confirm Google has actually
stopped indexing these URLs, or confirm they were never indexed to begin
with, is Google Search Console's URL Inspection tool or the Page Indexing
report — not a `site:` search. This session does not have Search Console
access (see `docs/seo/GOOGLE_SEARCH_CONSOLE_SETUP.md`). Once the site
owner has Search Console access set up, `/auth` and `/onboarding` should
be checked there directly rather than assumed.
