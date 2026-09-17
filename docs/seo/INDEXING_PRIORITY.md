# Indexing Priority Manifest

Date: 2026-09-17 (updated after Phases 5-8 completed the same session)
Author: SEO/growth execution session (Sprint 2, Phase 4; updated Phase 8)

Tiering follows the user's explicit structure: Tier 1 is the pages that
should anchor brand and category search; Tier 2 is trust/authority
infrastructure; Tier 3 is supporting long-tail content. "Status" reflects
what this session can verify directly (repo state + production
observation from `PRODUCTION_ROUTE_VERIFICATION.md`), not an indexing
claim — see the `SEARCH OBSERVATION` vs `INDEXING CONFIRMATION` note in
that document, which applies here too.

Internal-link counts below are from direct observation of the pages
checked in this sprint (nav + footer are sitewide and appear on every
page unless noted; "in main body" links are counted separately per page).
They are not a full site-wide backlink graph — that would require
crawling every route, which is out of scope for this manifest.

## Tier 1 — Primary brand & category anchors

| URL | Canonical | Sitemap | Indexable | Internal links in (sitewide nav/footer + notable body links) | Internal links out (body) | Schema | Search intent | Priority | Status |
|---|---|---|---|---|---|---|---|---|---|
| `/` | `https://protectbyeterna.com/` | Yes (priority 1.0, weekly) | Yes — no robots block | Linked from every page (logo/home link) | `#platform`, `#solutions`, `#how-it-works`, `/case-studies`, `/identity-response-observatory`, `/newsroom`, `/about`, `/security`, `/auth`, `/waitinglist`, `/methodology`, `/contact` | Repo has `organizationSchema`; not confirmed live via WebFetch (see tool-limitation note in verification matrix) | Brand ("Eterna Sentinel", "Eterna AI") | Highest | **Live**, but serving pre-redesign hero (PR #121 not deployed — see deployment audit) |
| `/image-immunization` | `https://protectbyeterna.com/image-immunization` | Yes (priority 0.9, weekly) | Yes | Sitewide nav (as of Sprint 1, unpushed) + footer Platform group (unpushed) + homepage CTA (unpushed) + 4 Newsroom guide "related reading" links (unpushed) + newsroom card | `/contact`, 4 EIP Newsroom articles | None on this specific route (not part of Sprint 1's schema additions — candidate for a future `WebPage`/`Product` schema pass) | Category: "deepfake protection," "image protection," EIP brand term | Highest | **Live** (PR #120 deployed); internal-linking upgrades from Sprint 1 not yet deployed |
| `/about` | `https://protectbyeterna.com/about` | Yes (priority 0.8, monthly) | Yes | Sitewide nav + footer Company group + homepage body link | `#platform`, `#solutions`, `#how-it-works`, `/case-studies`, `/identity-response-observatory`, `/newsroom`, `/waitinglist` ×2 | `AboutPage` schema added Sprint 1 — unpushed | Brand / company research ("who is Eterna Sentinel") | High | Live, schema not yet deployed |
| `/deepfake-protection` | `https://protectbyeterna.com/deepfake-protection` | Yes (priority 0.9, weekly) | Yes — no robots block | Footer Platform group + `/newsroom/someone-made-a-deepfake-of-me` + `/ai-impersonation` related reading (all unpushed) | `/image-immunization`, `/newsroom/detection-is-not-prevention`, `/methodology`, `/security`, `/newsroom/someone-made-a-deepfake-of-me`, `/newsroom/impersonation-response-guide`, `/newsroom/deepfake-verification-guide`, `/contact` | `WebPage` schema | Category pillar: "deepfake protection," "how to protect against deepfakes" | Highest | **Built, committed on `feature/seo-growth-sprint-2` — not yet deployed** |
| `/online-reputation-protection` | `https://protectbyeterna.com/online-reputation-protection` | Yes (priority 0.9, weekly) | Yes | Footer Platform group + `/deepfake-protection`-adjacent cross-links + `/ai-impersonation` related reading (all unpushed) | `/methodology`, `/deepfake-protection`, `/image-immunization`, `/newsroom/impersonation-response-guide`, `/case-studies`, `/identity-response-observatory`, `/contact` | `WebPage` schema | Category pillar: "online reputation protection," "reputation defense" | Highest | **Built, committed — not yet deployed** |

## Tier 2 — Trust & authority infrastructure

| URL | Canonical | Sitemap | Indexable | Internal links in | Internal links out (body) | Schema | Search intent | Priority | Status |
|---|---|---|---|---|---|---|---|---|---|
| `/methodology` | `https://protectbyeterna.com/methodology` | Yes (0.8, monthly) | Yes | Sitewide nav + footer + `/identity-response-observatory` body link | `/identity-response-observatory` | `WebPage` schema added Sprint 1 — unpushed | Trust/EEAT: "how does Eterna verify," methodology research | Medium-High | Live, schema not yet deployed |
| `/security` | `https://protectbyeterna.com/security` | Yes (0.7, monthly) | Yes | Sitewide nav + footer Legal/Company group | `/waitinglist?source=security-enquiry` | `WebPage` schema added Sprint 1 — unpushed | Trust/EEAT: security posture, responsible disclosure | Medium-High | Live, schema not yet deployed |
| `/identity-response-observatory` | `https://protectbyeterna.com/identity-response-observatory` | Yes (0.9, weekly) | Yes | Sitewide nav + footer + `/about` and `/methodology` body links | `/methodology`, `/contact` | `WebPage` schema added Sprint 1 — unpushed | Research/EEAT: incident transparency, "has Eterna handled X" | High (weekly changefreq signals this is meant to be a living page) | Live, schema not yet deployed |
| `/newsroom` | `https://protectbyeterna.com/newsroom` | Yes (0.8, weekly) | Yes | Sitewide nav + footer Newsroom group | 7 guide cards (8th, Sprint 1's, unpushed) | `CollectionPage` schema added Sprint 1 — unpushed | Hub: "Eterna Sentinel articles/guidance," discovery for all article-level search intent | High (hub page) | Live, schema and 8th article not yet deployed |
| `/newsroom/someone-made-a-deepfake-of-me` | `https://protectbyeterna.com/newsroom/someone-made-a-deepfake-of-me` | Yes (priority 0.8, monthly) | Yes | `/newsroom` guide card + `/deepfake-protection` (intro + related reading) + `/ai-impersonation` related reading (all unpushed) | `/image-immunization`, `/deepfake-protection`, `/newsroom` | `Article` schema | Emergency/high-intent: "someone made a deepfake of me," "deepfake of me what do I do" | High | **Built, committed — not yet deployed** |
| `/ai-impersonation` | `https://protectbyeterna.com/ai-impersonation` | Yes (priority 0.8, weekly) | Yes | Footer Platform group (unpushed) | `/newsroom/someone-made-a-deepfake-of-me`, `/image-immunization`, `/deepfake-protection`, `/newsroom/executive-first-hour-playbook`, `/newsroom/impersonation-response-guide`, `/online-reputation-protection`, `/contact` | `WebPage` schema | Category: "AI impersonation," "fake endorsement scam," "cloned voice scam" | Medium-High | **Built, committed — not yet deployed** |

## Tier 3 — Supporting articles & long-tail

| URL | Canonical | Sitemap | Indexable | Internal links in | Internal links out (body) | Schema | Search intent | Priority | Status |
|---|---|---|---|---|---|---|---|---|---|
| `/case-studies` | `https://protectbyeterna.com/case-studies` | Yes (0.7, monthly) | Yes | Sitewide nav + footer + homepage/about body links | `/waitinglist?source=case-studies` | `CollectionPage` schema added Sprint 1 — unpushed | "Eterna Sentinel results/proof," case-study research | Medium | Live, schema not yet deployed |
| `/contact` | `https://protectbyeterna.com/contact` | Yes (0.6, monthly) | Yes | Sitewide nav + footer + `/identity-response-observatory` body link | `/waitinglist` ×2, `/partner-apply`, `/auth`, `/security#responsible-disclosure` | `ContactPage` schema added Sprint 1 — unpushed | Transactional: "contact Eterna Sentinel" | Medium | Live, schema not yet deployed |
| `/newsroom/deepfake-verification-guide` | (pre-existing) | Yes (0.7, monthly) | Yes | `/newsroom` card | Not audited this pass | Not audited this pass (pre-Sprint-1 article; not touched by Sprint 1) | Long-tail: "how to verify a deepfake" | Medium | Live, unaudited by this sprint |
| `/newsroom/impersonation-response-guide` | (pre-existing) | Yes (0.7, monthly) | Yes | `/newsroom` card | Not audited this pass | Not audited this pass | Long-tail: "impersonation response" | Medium | Live, unaudited by this sprint |
| `/newsroom/executive-first-hour-playbook` | (pre-existing) | Yes (0.7, monthly) | Yes | `/newsroom` card | Not audited this pass | Not audited this pass | Long-tail: "executive impersonation first hour" | Medium | Live, unaudited by this sprint |
| `/newsroom/eterna-introduces-image-immunization` | (PR #120) | Yes (0.7, monthly) | Yes | `/newsroom` card + `/image-immunization` related-reading | Not audited this pass | Not audited this pass | Announcement / brand: "Eterna Image Immunization launch" | Medium | Live |
| `/newsroom/what-is-image-immunization` | (PR #120) | Yes (0.7, monthly) | Yes | `/newsroom` card + `/image-immunization` related-reading + `/newsroom/detection-is-not-prevention` related-reading (unpushed) | Not audited this pass | Not audited this pass | Definitional: "what is image immunization" | Medium | Live |
| `/newsroom/inside-eterna-image-immunization` | (PR #120) | Yes (0.7, monthly) | Yes | `/newsroom` card + `/image-immunization` related-reading + own related-reading section (links to `/newsroom/what-is-image-immunization`, `/newsroom/how-eterna-validates-image-immunization-responsibly`, `/methodology`) | `/newsroom/how-eterna-validates-image-immunization-responsibly`, `/newsroom/what-is-image-immunization`, `/methodology` | `Article` schema (confirmed present in repo, this route predates Sprint 1) | Technical/authority: "how does image immunization work" | Medium | Live |
| `/newsroom/how-eterna-validates-image-immunization-responsibly` | (PR #120) | Yes (0.7, monthly) | Yes | `/newsroom` card + `/image-immunization` related-reading | Not audited this pass | Not audited this pass | Trust/EEAT: "is image immunization validated," claims-safety | Medium | Live |
| `/newsroom/detection-is-not-prevention` | Sprint 1 (unpushed) | Not yet — needs deploy first | No — 404 on production currently | Would be linked from `/newsroom` card, `/image-immunization`, `/newsroom/what-is-image-immunization` once deployed | `/image-immunization`, `/newsroom/what-is-image-immunization`, `/methodology`, `/newsroom/impersonation-response-guide` | `Article` schema, written Sprint 1 | Conceptual: "detection vs prevention deepfake" | Medium | **Built, not deployed** |
| `/partner-apply` | (pre-existing) | Yes (0.5, monthly) | Yes | Footer + `/contact` body link + homepage/auth | Not audited this pass | Not audited this pass | Transactional: partner signup | Low-Medium | Live, unaudited by this sprint |
| `/waitinglist` (+ variants) | (pre-existing) | Yes (0.6, monthly) | Yes | Linked from nearly every page's CTA, with `?source=` query variants | Not audited this pass | Not audited this pass | Transactional: lead capture | Low (functional, not a search-discovery target) | Live |
| `/privacy`, `/terms`, `/cookies`, `/acceptable-use` | (pre-existing) | Yes (0.3, yearly) | Yes | Footer Legal group | Not audited this pass | Not audited this pass | Compliance/legal — not a growth target | Low | Live |

## Not in this manifest (deliberately excluded from indexing)

| URL | Status |
|---|---|
| `/auth` | Should be crawlable but `noindex, follow` once Sprint 2's fix deploys — see `AUTH_ONBOARDING_INDEX_CONTROL.md`. Currently still `Disallow`'d + `noindex, nofollow` on production. |
| `/onboarding` | Same as `/auth`. |
| `/agent`, `/agent-admin`, `/agent-assessment`, `/partner`, `/verify/`, `/face-handoff/`, `/api/` | Correctly `Disallow`'d in `robots.txt`; not part of this manifest, not changed by this sprint. |

## Next update to this manifest

Phases 5-8 are now built and committed on `feature/seo-growth-sprint-2`
(layered on top of `feature/seo-growth-sprint-1`), with real routes,
schema and internal linking as recorded above. None of it is deployed —
this branch has not been pushed (push access is blocked for this
session; see the deployment audit) or merged. This manifest should be
revised again once: (a) the deploy gap in `PRODUCTION_DEPLOYMENT_AUDIT.md`
is resolved so PR #121 goes live, and (b) `feature/seo-growth-sprint-1`
and `feature/seo-growth-sprint-2` are merged and deployed, at which point
every row above marked "not yet deployed" should be re-verified against
production the same way `PRODUCTION_ROUTE_VERIFICATION.md` did for the
existing routes.
