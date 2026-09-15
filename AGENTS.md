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

## Cursor Cloud specific instructions

This is a Lovable-connected **TanStack Start** (Vite 8 / React 19) monorepo — "Eterna AI",
an AI-powered digital-protection / reputation-monitoring platform. **Bun** is the intended
package manager (`bunfig.toml` + `bun.lock`); the startup update script installs Bun to
`~/.bun/bin` and runs `bun install`. Bun is on the PATH in login shells (the installer added
it to `~/.bashrc`); if a non-login shell can't find it, call `~/.bun/bin/bun` directly.

Services (scripts live in `package.json`; see `.env.example` for the full integration list):

- **Main web app** (root) — the product. Run with `bun run dev` (Vite dev server on
  **http://localhost:8080**, not the default 5173 — the Lovable config sets the port/host).
  Lint: `bun run lint`. Tests: `bun run test:evidence`. Build: `bun run build` (Nitro →
  Cloudflare Worker target). The router auto-regenerates `src/routeTree.gen.ts` on dev — do
  not commit that churn.
- **crawler-service/** (Python FastAPI, Crawl4AI) — OPTIONAL. `pip install -r requirements.txt`
  then `uvicorn app.main:app`. Needs `BRAVE_API_KEY`.
- **services/enforcement-worker/** (Node + Playwright) — OPTIONAL. `npm install` then
  `npm run dev` (port 8080 internally). Needs `ETERNA_HOOK_URL` + `AUTOMATION_WORKER_SECRET`.

Key gotchas:

- **Supabase is a hard boot dependency.** `src/lib/env.server.ts` validates required env at
  import time; the checked-in `.env` already points at a live hosted Supabase project (anon
  key), so the app boots and auth/DB work out of the box. `SUPABASE_SERVICE_ROLE_KEY` is
  optional in dev (admin-only ops disabled) but required in production.
- **Onboarding cannot be fully completed here.** Step 2 of the onboarding wizard requires
  Veriff KYC (external, needs `VERIFF_*` keys). A new signup reaches the wizard and can save
  the Step-1 client profile (persists to Supabase), then blocks at Step 2 without Veriff.
- Email confirmation is **disabled** on the configured Supabase project, so email/password
  signup returns a session immediately (no inbox step needed for local testing).
- Most feature integrations (Firecrawl, Google/YouTube, AWS Rekognition, Veriff, Brave) are
  optional and degrade gracefully when unset; the multimedia providers default to `stub`.
- `bun run lint` currently reports many **pre-existing** prettier/style errors across the
  repo — that reflects the repo state, not a broken setup.
