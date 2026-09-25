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
