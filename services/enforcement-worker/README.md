# Enforcement Worker Service

External Node + Playwright worker that runs browser automation jobs for the
Eterna enforcement engine. Deployed **outside** the Cloudflare Worker
runtime — Fly.io, Railway, Render, or a VM.

## Why it lives here

Eterna's Cloudflare Worker backend cannot spawn Chromium, spawn child
processes, or persist browser profiles. Every automation task that needs
a real browser (form-fill, evidence upload, review-summary capture) runs
in this service. Eterna talks to it only through the shared Supabase
queue and two HMAC-authenticated webhook endpoints:

- `POST /api/public/hooks/automation-fetch` — worker fetches a queued job's
  input, signed URLs for evidence, and the decrypted platform storageState
  (Eterna decrypts; the key never leaves Eterna).
- `POST /api/public/hooks/automation-status` — worker posts audit events,
  status transitions, screenshots, and the final review summary back.

Both endpoints are signed with `AUTOMATION_WORKER_SECRET` and a ±5-minute
timestamp.

## Architecture (Batch 1 — this scaffold)

```text
services/enforcement-worker/
├── src/
│   ├── index.ts            HTTP server + poller entry
│   ├── config.ts           env parsing (zod), timeouts, retry policy
│   ├── eterna.ts           HMAC-signed client for Eterna hooks
│   ├── runner.ts           job lifecycle (browser context, adapter dispatch)
│   ├── audit.ts            structured audit event helper
│   ├── session.ts          storageState restore + login-required detection
│   └── adapters/
│       ├── types.ts        PlatformAdapter interface
│       └── youtube.ts      YouTubeCopyrightAdapter / CommunityAdapter stubs
├── package.json
├── tsconfig.json
├── Dockerfile
├── fly.toml.example
└── README.md
```

## Batch status

- **Batch 1 (this commit):** scaffold, HMAC transport, adapter interface,
  YouTube adapters stubbed with the field-mapping schema and Review-screen
  stop rules. Not yet capable of running a real job end-to-end.
- **Batch 2:** live YouTube adapters (Copyright + Community), storageState
  onboarding page hosted by this service, unit tests.
- **Batch 3:** live CDP hand-off URL, retry/backoff, integration tests
  against a mock form, hardening.

## Local dev

```bash
cd services/enforcement-worker
cp .env.example .env    # fill ETERNA_HOOK_URL and AUTOMATION_WORKER_SECRET
bun install             # or npm install
bunx playwright install chromium
bun run dev
```

## Environment

| Var                       | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `ETERNA_HOOK_URL`         | Base URL of the Eterna app (`https://…lovable.app`).       |
| `AUTOMATION_WORKER_SECRET`| Shared HMAC secret. Must match Eterna's secret of the same name. |
| `WORKER_ID`               | Human-readable id for this instance (goes into audit rows).|
| `PROFILE_DIR`             | Path to persistent browser profile dir (recommend Fly volume). |
| `PORT`                    | HTTP port for `/run` and `/health`. Default 8080.          |

**Never** put a Supabase service-role key on this service. It calls Eterna's
signed hooks, and Eterna decrypts credentials for one job at a time.

## Security

- storageState decrypted only in memory per job; never written to disk on
  the worker.
- Screenshots uploaded via signed URLs to the private `enforcement-screenshots`
  bucket.
- HMAC + timestamp window on every hook call.
- No auto-submit on any web form — the worker stops at the Review screen
  and posts the review-summary payload back for a human operator to click
  Submit inside the live browser session.

## Deploying to Fly.io

```bash
cp fly.toml.example fly.toml
fly launch --copy-config --no-deploy
fly volumes create profiles --size 5    # persistent browser profile dir
fly secrets set ETERNA_HOOK_URL=https://your.eterna.app \
  AUTOMATION_WORKER_SECRET=... WORKER_ID=fly-worker-1
fly deploy
```
