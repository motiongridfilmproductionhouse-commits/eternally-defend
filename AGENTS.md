<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->
- EIP engine integration: the platform only talks to a private engine service via the `/api/public/hooks/eip-worker` worker (token-guarded DB RPCs, no service role); results are accepted only from a validated manifest with matching hashes — why: never fabricate EIP outcomes or expose engine internals. Contract: docs/eip-engine-contract.md.
- General web search uses Firecrawl plus the owner-approved Brave provider, while Instagram scans may additionally use the linked Apify Instagram actor behind bounded server-only requests; no provider silently replaces another — why: broaden auditable coverage without exposing credentials or misreporting queried sources.
- Manipulation analysis may inspect non-unrelated media awaiting identity review, but only MATCHED discoveries appear in findings or risk totals — why: find genuine signals without attributing uncertain identities.
- Public surfaces must not expose client-derived stories, identities, identifiers, or dates; certificate verification returns status only — why: client confidentiality applies platform-wide.
- Public SEO landing pages use src/components/public/ServiceLanding.tsx (landingHead + Service/WebPage JSON-LD + breadcrumbs); PublicPage emits BreadcrumbList and newsroom related links — why: consistent canonical, schema and internal linking across public pages.
- Submitted removal requests (enforcement_requests Sent/Approved/Rejected) auto-create one linked case via a DB trigger keyed on cases.metadata.enforcement_request_id — why: removals must never exist without a case.
- Pay-per-link removals: customer reads go only through caseId+email server fns returning customer-safe fields; staff ops via has_role-checked server fns; every change appends to removal_order_events — why: internal notes, evidence paths and history must never leak or be overwritten.
