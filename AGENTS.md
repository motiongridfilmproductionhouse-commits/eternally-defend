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
- Search discovery uses Firecrawl plus the owner-approved Brave provider, gated by src/lib/scan/search-policy.ts; all other providers remain disabled — why: broaden auditable coverage without silent fallback.
- Manipulation analysis may inspect non-unrelated media awaiting identity review, but only MATCHED discoveries appear in findings or risk totals — why: find genuine signals without attributing uncertain identities.
- Public surfaces must not expose client-derived stories, identities, identifiers, or dates; certificate verification returns status only — why: client confidentiality applies platform-wide.
