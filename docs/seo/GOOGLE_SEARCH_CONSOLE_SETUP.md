# Google Search Console Setup — Owner Action Required

Date: 2026-09-17
Author: SEO/growth execution session (Sprint 2, Phase 3)

This session has no Google Search Console (GSC) access and no way to
create or verify a property on the owner's behalf — GSC verification
requires either DNS control, hosting-provider access, or file/tag access
to the live domain, none of which this session has credentials for. This
document is the handoff: exact steps for whoever does have access to
`protectbyeterna.com`'s DNS or hosting.

**Nothing in this document invents a DNS record, TXT value, or
verification token.** Google generates the actual verification value at
the moment a property is added — it is unique per property and per
verification attempt, and cannot be predicted or fabricated in advance.
Wherever this document references a value Google provides, it says so
explicitly rather than making one up.

## 1. Which property type to use

Prefer a **Domain property** over a URL-prefix property:
`protectbyeterna.com`. A Domain property automatically covers `http://`,
`https://`, `www.` and non-`www.` variants and any subdomains, which is
the more complete and lower-maintenance option. A URL-prefix property
(`https://protectbyeterna.com/`) only works if DNS verification isn't
available to the person doing the setup — it needs one of: an uploaded
HTML file, an HTML meta tag in `<head>`, or Google Analytics/Tag Manager
already installed and linked to the same Google account.

## 2. Verification steps (Domain property, DNS method)

1. Go to https://search.google.com/search-console and choose "Add
   property" → "Domain."
2. Enter `protectbyeterna.com` (no `https://`, no trailing slash).
3. Google will display a **TXT record verification value** at that point
   — a string starting with `google-site-verification=` followed by a
   token unique to this property and this verification attempt. Copy that
   exact value from the Google Search Console UI; do not use any value
   from this document, since none is provided here.
4. Add that exact TXT record to `protectbyeterna.com`'s DNS zone, at the
   root (`@`), through whatever DNS provider manages the domain (this
   session does not know which provider that is — check the domain
   registrar or, if DNS is proxied through Cloudflare per the hosting
   evidence in `docs/deployment/PRODUCTION_DEPLOYMENT_AUDIT.md`, the
   Cloudflare DNS dashboard for this zone).
5. Return to Search Console and click "Verify." DNS propagation can take
   anywhere from a few minutes to 48 hours; if verification fails
   immediately after adding the record, wait and retry rather than
   assuming failure.

### If DNS access isn't available to whoever runs this step

Use a URL-prefix property (`https://protectbyeterna.com/`) instead, and
verify with the **HTML tag** method: Search Console will generate a
`<meta name="google-site-verification" content="...">` tag with its own
unique value (again, generated at the time — not reproduced here). That
tag needs to be added to the `<head>` of the site's global layout, most
likely `src/components/public/PublicSite.tsx`'s `PublicPage` component or
the router's root document config, so it's present on every page.
Whoever implements this should treat it as a real code change requiring
its own review, not something to paste in blind — and note that this
route only verifies `https://protectbyeterna.com/`, not the domain as a
whole, so it will need to be repeated for `www.protectbyeterna.com` if
that's also served.

## 3. After verification: submit the sitemap

Once the property is verified, in Search Console go to **Sitemaps** (left
sidebar) and submit:

```
https://protectbyeterna.com/sitemap.xml
```

This is the sitemap's confirmed, currently-live URL (checked directly this
session — see `docs/seo/PRODUCTION_ROUTE_VERIFICATION.md`, row 13).
Submitting it queues it for processing; Search Console will report how
many URLs were discovered and, over the following days, how many were
indexed versus excluded (and why, for excluded ones). That per-URL status
is the actual "is this indexed" answer — not a `site:` search (see the
note in `docs/seo/AUTH_ONBOARDING_INDEX_CONTROL.md` and
`PRODUCTION_ROUTE_VERIFICATION.md` on `SEARCH OBSERVATION` vs
`INDEXING CONFIRMATION`).

## 4. Priority URLs for manual URL Inspection

Once the sitemap is submitted, Search Console's automatic crawl/index
cycle can take days to weeks to work through every URL. For faster
diagnostic signal on the pages that matter most, use the **URL Inspection
tool** (top search bar in Search Console) individually on these URLs, in
this order:

1. `https://protectbyeterna.com/` — homepage, highest priority
2. `https://protectbyeterna.com/image-immunization` — EIP pillar page
3. `https://protectbyeterna.com/newsroom/detection-is-not-prevention` —
   will 404 until the Sprint 1 branch is deployed; re-check after deploy
4. `https://protectbyeterna.com/newsroom` — Newsroom index
5. `https://protectbyeterna.com/about`
6. `https://protectbyeterna.com/methodology`
7. `https://protectbyeterna.com/security`
8. `https://protectbyeterna.com/identity-response-observatory`
9. Remaining sitemap URLs, as time allows: `/case-studies`, `/contact`,
   `/newsroom/deepfake-verification-guide`,
   `/newsroom/impersonation-response-guide`,
   `/newsroom/executive-first-hour-playbook`,
   `/newsroom/eterna-introduces-image-immunization`,
   `/newsroom/what-is-image-immunization`,
   `/newsroom/inside-eterna-image-immunization`,
   `/newsroom/how-eterna-validates-image-immunization-responsibly`

For each, URL Inspection reports whether Google has the URL indexed,
whether the live version matches what was last crawled, and — if not
indexed — the specific reason (not found, crawled but not indexed,
blocked by robots.txt, etc.). If `/auth` or `/onboarding` were ever
indexed under the old `Disallow` + `noindex, nofollow` configuration
(unlikely but not confirmed either way — see
`AUTH_ONBOARDING_INDEX_CONTROL.md`), URL Inspection is also the right tool
to confirm whether they drop out after the fix is deployed. Use "Request
indexing" for individual URLs only after confirming the live version is
correct — requesting indexing on a stale or broken page just wastes the
crawl budget Google allocates to this property.

## 5. What Search Console does *not* guarantee

Submitting a sitemap or requesting indexing on a URL does not guarantee
Google will index that URL, and does not guarantee a timeline. Google
independently decides what to crawl and index based on many factors
(perceived quality, crawl budget, duplication, site-wide trust signals).
Nothing in this document, or in any report produced by this SEO
engagement, should be read as a promise that a given page will be
indexed, or indexed by a given date.

## 6. Recommended follow-on connection: Google Analytics / GA4

Not part of this phase's requirement, but worth noting: linking a GA4
property to the same Search Console property (Search Console → Settings →
Associations) unlocks combined search-and-behavior reporting. This session
found no Google Analytics MCP connector available in this environment's
connector registry — if the owner wants Claude to help analyze that data
directly in a future session, that would need to be set up as a
connection first.
