# Primary Navigation IA Redesign

Grouped the flat 9-item desktop navigation into 4 dropdown categories + the
Request Protection CTA. No routes, canonicals, sitemap entries, or page
content changed — this is a navigation-organization change only, implemented
entirely in `src/components/public/PublicSite.tsx` (plus two small,
backward-compatible additions to `src/components/ui/accordion.tsx` and
`src/styles.css`).

## Before

```
Platform | Solutions | Image Immunization | How It Works | Case Studies |
Observatory | Newsroom | Company | Resources        [Client Sign In] [Request Protection]
```

## After

```
Platform ▾ | Solutions ▾ | Research ▾ | Company ▾        [Client Sign In] [Request Protection]
```

`Resources` was folded away rather than kept as a near-empty fifth dropdown:
auditing the route tree turned up no dedicated Resources-only content (no
guides/FAQ/help/documentation routes) beyond what the old `Resources` item
already pointed at (`/security`), which now lives under `Company` — matching
the fallback this redesign was scoped against ("prefer fewer meaningful
categories over keeping an unnecessary Resources category").

## Category map (parent → child → route)

Every destination below is a real, pre-existing route or in-page anchor.
None were invented.

### Platform

| Child | Destination |
| --- | --- |
| Platform Overview | `/#platform` (homepage `#platform` section) |
| How It Works | `/#how-it-works` (homepage `#how-it-works` section) |
| Image Immunization *(emphasized)* | `/image-immunization` |

### Solutions

| Child | Destination |
| --- | --- |
| Solutions Overview | `/#solutions` (homepage `#solutions` section) |
| Deepfake Protection | `/deepfake-protection` |
| AI Impersonation | `/ai-impersonation` |
| Online Reputation Protection | `/online-reputation-protection` |

`Public Figure / Individual Protection` and `Organization / Enterprise
Protection` were suggested in the brief as "likely items," but no dedicated
route or stable anchor exists for either (they're just audience cards on the
homepage, not a page or a targetable section). Per "do not create empty/fake
pages just to complete the menu," they were left out rather than invented.

### Research

| Child | Destination |
| --- | --- |
| Observatory | `/identity-response-observatory` |
| Case Studies | `/case-studies` |
| Newsroom | `/newsroom` |
| Methodology | `/methodology` |

### Company

| Child | Destination |
| --- | --- |
| About Eterna | `/about` |
| Security | `/security` |
| Responsible Disclosure | `/security#responsible-disclosure` |
| Contact | `/contact` |

## Orphan check

Every one of the original 9 top-level destinations maps to exactly one new
location; none were dropped:

| Old top-level item | New location |
| --- | --- |
| Platform (`/#platform`) | Platform → Platform Overview |
| Solutions (`/#solutions`) | Solutions → Solutions Overview |
| Image Immunization | Platform → Image Immunization (emphasized) |
| How It Works (`/#how-it-works`) | Platform → How It Works |
| Case Studies | Research → Case Studies |
| Observatory | Research → Observatory |
| Newsroom | Research → Newsroom |
| Company (`/about`) | Company → About Eterna |
| Resources (`/security`) | Company → Security |

`Methodology` (`/methodology`) was previously reachable only from the
footer; it's now also in the primary nav (Research), which only adds a path
to an existing page — it doesn't change the route itself.

## Implementation notes

- **Desktop**: `@radix-ui/react-navigation-menu` used directly (not the
  shared shadcn wrapper, and without its shared `Viewport`), so each
  category's panel is a small, independently positioned dropdown rather than
  a single mega-menu-style panel that slides between triggers. Hover *or*
  click opens; native `Escape`/click-outside dismissal, single-open-at-a-time,
  and `aria-expanded`/`aria-controls` all come from the primitive itself.
- **Mobile**: the existing `Accordion` component (already used for FAQ
  sections elsewhere on the site) drives expandable categories, `type="multiple"`
  so more than one section can stay open at once.
- **Crawlability**: both the desktop dropdown content and the mobile
  accordion content are rendered with `forceMount` and hidden purely with
  CSS (`hidden` / `data-[state=open]:block`), instead of being mounted only
  after a user interacts with the trigger. That keeps every destination link
  present as a real, crawlable `<a href>` in the server-rendered HTML at all
  times — important since Google crawls with a mobile user agent by default,
  which would otherwise never see the links inside a JS-gated mobile menu.
  The `accordion.tsx` change is additive only: existing non-`forceMount`
  callers (the FAQ accordions elsewhere on the site) are unaffected, since
  their content is still unmounted entirely while collapsed.
- **Image Immunization emphasis**: a subtle tinted/bordered treatment inside
  the Platform dropdown (`.eterna-nav-emphasis` in `styles.css`, reusing the
  same `color-mix()` pattern already used by the homepage's EIP visual), not
  a separate top-level nav item.
