# Production Route Verification Matrix

Date: 2026-09-17
Author: SEO/growth execution session (Sprint 2, Phase 1)
Method: Direct `WebFetch` requests against `https://protectbyeterna.com`,
each with a unique cache-busting query parameter, run in this session.
Cross-referenced against the repository state documented in
`docs/deployment/PRODUCTION_DEPLOYMENT_AUDIT.md`.

**Important scope note (Phase 2 compliance):** everything in this document
is a direct observation of what a page currently returns — HTTP status,
markup, meta tags. None of it is a claim about Google's indexing state.
Where indexing is discussed at all, it is explicitly labeled
`SEARCH OBSERVATION` and never `INDEXING CONFIRMATION` — see the note at
the end of this document. This session has no Google Search Console
access; real indexing diagnostics require it (see
`docs/seo/GOOGLE_SEARCH_CONSOLE_SETUP.md`).

**Known tool limitation:** `WebFetch` converts HTML to markdown via an
intermediate model before returning it. It reliably surfaces `<title>`,
meta tags, headings, links and visible text, but is not a reliable way to
confirm the *absence* of a `<script type="application/ld+json">` block —
in earlier checks this session, a page confirmed (by direct repo/source
inspection) to contain JSON-LD still sometimes did not surface it through
this path. Every "no structured data detected" result below should be read
as "not detected by this tool," not "confirmed absent." Mobile layout and
rendered visual behavior are not observable through `WebFetch` at all — a
real mobile-viewport check (Lighthouse, a device emulator, or manual
review) is needed to complete that column and is flagged as outstanding
below rather than guessed at.

## Matrix

| # | URL | HTTP status | Title | Meta description | Canonical | Robots meta | H1 | Structured data | Open Graph | Mobile layout | Internal links (body) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/` | 200 | "Eterna Sentinel: Digital Identity Protection" | "Digital identity protection for people and organizations in the public eye, with evidence-led investigation and human review." | `https://protectbyeterna.com/` | none found | "Digital identity protection for people and organizations in the public eye." (pre-redesign hero — see deployment audit, PR #121 not yet deployed) | Not detected by WebFetch; repo confirms an `organizationSchema` block exists in `index.tsx` — see tool-limitation note above | og:title, og:type=website, og:image present | **Not verified this pass** — needs Lighthouse/device check | `#platform`, `#solutions`, `#how-it-works`, `/case-studies`, `/identity-response-observatory`, `/newsroom`, `/about`, `/security`, `/auth`, `/waitinglist`, `/methodology`, `/contact`, footer links |
| 2 | `/image-immunization` | 200 | "Eterna Image Immunization: Protect the Image Before Misuse Begins" | "Eterna Image Immunization (EIP), Eterna's proprietary pre-publication image protection technology. Developed through internal R&D, currently under validation." | `https://protectbyeterna.com/image-immunization` | none found | "Protect the Image Before Misuse Begins." | Not detected by WebFetch (repo has no schema on this specific route — confirmed, this page was not one of Sprint 1's schema additions) | og:title, og:type=website, og:description, og:image, twitter:card=summary | **Not verified this pass** | `/contact`, `/newsroom/eterna-introduces-image-immunization`, `/newsroom/what-is-image-immunization`, `/newsroom/inside-eterna-image-immunization`, `/newsroom/how-eterna-validates-image-immunization-responsibly` |
| 3 | `/newsroom` | 200 | "Newsroom & Insights: Eterna Sentinel" | "Eterna Sentinel guidance on deepfake verification and impersonation response, written and published by Eterna." | `https://protectbyeterna.com/newsroom` | none found | "Guidance Eterna publishes, written by Eterna." | Not detected by WebFetch; repo has a `CollectionPage` schema on this route as of Sprint 1 (unpushed) | og:title, og:type=website, og:image present | **Not verified this pass** | 7 guide cards: deepfake-verification-guide, impersonation-response-guide, executive-first-hour-playbook, eterna-introduces-image-immunization, what-is-image-immunization, inside-eterna-image-immunization, how-eterna-validates-image-immunization-responsibly. Sprint 1's 8th card ("Detection Is Not Prevention") correctly absent — unpushed. |
| 4 | `/newsroom/detection-is-not-prevention` | **404** | — | — | — | — | — | — | — | — | Expected: this article exists only on the unpushed `feature/seo-growth-sprint-1` branch. |
| 5 | `/about` | 200 | "About Eterna Sentinel: Digital Protection" | "Meet Eterna Sentinel, a managed digital identity, reputation and content protection operation built around evidence and human judgment." | `https://protectbyeterna.com/about` | none found | "Protection built for the realities of public identity." | Not detected by WebFetch; repo has an `AboutPage` schema as of Sprint 1 (unpushed) | og:title, og:type=website, og:image present | **Not verified this pass** | `#platform`, `#solutions`, `#how-it-works`, `/case-studies`, `/identity-response-observatory`, `/newsroom`, `/waitinglist?source=request-protection`, `/waitinglist?source=company-enquiry` |
| 6 | `/security` | 200 | "Security & Governance: Eterna Sentinel" | "How Eterna Sentinel governs authorization, identity verification, evidence, human review and sensitive information." | `https://protectbyeterna.com/security` | none found | "Evidence preserved. Actions governed." | Not detected by WebFetch; repo has a `WebPage` schema as of Sprint 1 (unpushed) | og:title, og:type=website, og:image present | **Not verified this pass** | `/waitinglist?source=security-enquiry` |
| 7 | `/methodology` | 200 | "Verification Methodology: Eterna Sentinel" | "The four-part standard Eterna Sentinel applies before any impersonation, deepfake or content-misuse finding is treated as verified." | `https://protectbyeterna.com/methodology` | none found | "What counts as verified, and why it matters." | Not detected by WebFetch; repo has a `WebPage` schema as of Sprint 1 (unpushed) | og:title, og:type=website, og:image present | **Not verified this pass** | `/identity-response-observatory` |
| 8 | `/identity-response-observatory` | 200 | "Eterna Identity Response Observatory" | "Eterna's initiative to build a sourced, methodology-transparent public record of digital-identity incidents: verified, reported or disputed, and shown that way." | `https://protectbyeterna.com/identity-response-observatory` | none found | "A public record of digital-identity incidents, built to be checked, not just cited." | Not detected by WebFetch; repo has a `WebPage` schema as of Sprint 1 (unpushed) | og:title, og:type=website, og:image present | **Not verified this pass** | `/methodology`, `/contact` |
| 9 | `/case-studies` | 200 | "Protection in Practice: Eterna Sentinel" | "Anonymized examples of Eterna Sentinel detection, investigation, evidence preservation and governed response workflows." | `https://protectbyeterna.com/case-studies` | none found | "Real activity. Careful conclusions." | Not detected by WebFetch; repo has a `CollectionPage` schema as of Sprint 1 (unpushed) | og:title, og:type=website, og:image present | **Not verified this pass** | `/waitinglist?source=case-studies` |
| 10 | `/contact` | 200 | "Contact Eterna Sentinel" | "Reach Eterna Sentinel for protection requests, business enquiries, media, partnerships or client support." | `https://protectbyeterna.com/contact` | none found | "Reach the right team the first time." | Not detected by WebFetch; repo has a `ContactPage` schema as of Sprint 1 (unpushed) | og:title, og:type=website, og:image present | **Not verified this pass** | `/waitinglist?source=contact-protection-request`, `/waitinglist?source=contact-business-enquiry`, `/partner-apply`, `/auth`, `/security#responsible-disclosure` |
| 11 | `/auth` | **Blocked — `ROBOTS_DISALLOWED`** | Not retrievable | Not retrievable | Not retrievable | Repo (unpushed, Sprint 1/2): `noindex, follow` as of this branch; production repo state at time of this check still ships `noindex, nofollow` since Sprint 1 is unpushed | Not retrievable | Not retrievable | Not retrievable | Not retrievable | This session's own crawler-compliant fetch tool was refused by production `robots.txt`'s current `Disallow: /auth` rule — direct, reproducible proof of the crawl-block problem described in `docs/seo/AUTH_ONBOARDING_INDEX_CONTROL.md`. Fix exists on `feature/seo-growth-sprint-2` (unpushed). |
| 12 | `/onboarding` | **Blocked — `ROBOTS_DISALLOWED`** | Not retrievable | Not retrievable | Not retrievable | Same as `/auth` — fix unpushed | Not retrievable | Not retrievable | Not retrievable | Not retrievable | Same as `/auth`. |
| 13 | `/sitemap.xml` | 200 | n/a (XML) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 22 URLs listed (see full list below). Does not yet include `/newsroom/detection-is-not-prevention` or any Phase 5–8 pages — expected, since Sprint 1/2 are unpushed. |
| 14 | `/robots.txt` | 200 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Still shows the pre-fix rules: `Disallow: /auth` and `Disallow: /onboarding` both present and live on production. Confirms the Sprint 2 robots.txt fix has not been deployed. |

### `/sitemap.xml` full contents (as currently live)

```
https://protectbyeterna.com/                                                       weekly   1.0
https://protectbyeterna.com/about                                                  monthly  0.8
https://protectbyeterna.com/security                                               monthly  0.7
https://protectbyeterna.com/methodology                                            monthly  0.8
https://protectbyeterna.com/identity-response-observatory                          weekly   0.9
https://protectbyeterna.com/case-studies                                           monthly  0.7
https://protectbyeterna.com/newsroom                                               weekly   0.8
https://protectbyeterna.com/newsroom/deepfake-verification-guide                   monthly  0.7
https://protectbyeterna.com/newsroom/impersonation-response-guide                  monthly  0.7
https://protectbyeterna.com/newsroom/executive-first-hour-playbook                 monthly  0.7
https://protectbyeterna.com/image-immunization                                     weekly   0.9
https://protectbyeterna.com/newsroom/eterna-introduces-image-immunization          monthly  0.7
https://protectbyeterna.com/newsroom/what-is-image-immunization                    monthly  0.7
https://protectbyeterna.com/newsroom/inside-eterna-image-immunization              monthly  0.7
https://protectbyeterna.com/newsroom/how-eterna-validates-image-immunization-responsibly  monthly  0.7
https://protectbyeterna.com/contact                                                monthly  0.6
https://protectbyeterna.com/partner-apply                                          monthly  0.5
https://protectbyeterna.com/waitinglist                                            monthly  0.6
https://protectbyeterna.com/privacy                                                yearly   0.3
https://protectbyeterna.com/terms                                                  yearly   0.3
https://protectbyeterna.com/cookies                                                yearly   0.3
https://protectbyeterna.com/acceptable-use                                         yearly   0.3
```

## What this confirms, in one place

- All 9 currently-live public content routes (`/`, `/image-immunization`,
  `/newsroom`, `/about`, `/security`, `/methodology`,
  `/identity-response-observatory`, `/case-studies`, `/contact`) return
  200, have correct titles, meta descriptions and canonical tags, and have
  Open Graph coverage. This is a solid baseline independent of anything
  Sprint 1 or 2 changed.
- None of them currently expose a robots meta tag (none needed one — all
  are meant to be indexed) and none currently show detectable JSON-LD
  structured data in production, which is the expected, correct state
  before Sprint 1's schema work is deployed.
- `/auth` and `/onboarding` are confirmed, first-hand, to be blocked to
  compliant crawlers by production's current `robots.txt` — this is the
  exact problem Phase 0/Auth-Onboarding fix addresses, and the fix is
  ready but not yet deployed (see `PRODUCTION_DEPLOYMENT_AUDIT.md`).
- The sitemap and robots.txt are both internally consistent with each
  other and with a pre-Sprint-1 production build — there is no
  contradiction to explain beyond the deploy gap already documented.

## Outstanding for a future pass

- **Mobile layout**: not checked in this pass — `WebFetch` has no way to
  observe rendered/responsive layout. Needs either a Lighthouse mobile run
  or a manual device/emulator check. Flagged rather than guessed at.
- **Structured data presence on `/`**: the repo is known to contain an
  `organizationSchema` block on the homepage, but `WebFetch` did not
  surface it in this or the prior pass. This is logged as a tool
  limitation, not a confirmed absence — worth a direct "View Source" or
  `curl`-based check once a channel exists that isn't blocked by the
  sandbox's egress proxy.

## Indexing status: `SEARCH OBSERVATION` vs `INDEXING CONFIRMATION`

Per Phase 2 of this sprint: nothing above should be read as a statement
about what Google has indexed. This document is limited to what each URL
currently serves. Any future indexing claim in this project must come from
Google Search Console (URL Inspection tool, Page Indexing report, Crawl
Stats, or sitemap processing status) and must be labeled
`INDEXING CONFIRMATION` only when it comes from one of those sources. A
`site:protectbyeterna.com` search result, if used at all, must be labeled
`SEARCH OBSERVATION` and treated as suggestive at best — see
`docs/seo/GOOGLE_SEARCH_CONSOLE_SETUP.md` for how to get real indexing
diagnostics.
