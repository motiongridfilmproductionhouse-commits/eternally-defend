# EIP engine service contract (Eterna platform ⇄ private EIP engine)

The Eterna platform never runs the EIP algorithm. A private engine service wraps
the production EIP adapter. The browser never talks to it.

## Platform configuration (server-side secrets only)

| Name | Meaning |
|---|---|
| `EIP_ENGINE_ENABLED` | `true` to let the worker call the engine. Anything else = disabled (jobs stay queued). |
| `EIP_ENGINE_BASE_URL` | `https://…` in production. `http://127.0.0.1:PORT` only for local dev. |
| `EIP_ENGINE_SERVICE_TOKEN` | Bearer token the engine verifies (constant-time compare). |
| `EIP_ENGINE_TIMEOUT_SECONDS` | Whole-job timeout (default 3600). |
| `EIP_ENGINE_VERSION_EXPECTED` | If set, any other engine version is rejected (`ENGINE_VERSION_MISMATCH`). |
| `EIP_ENGINE_CONFIG_SHA256_EXPECTED` | If set, the frozen config SHA-256 must match (`CONFIG_INTEGRITY_FAILED`). |
| `EIP_EVALUATION_VERSION` | Currently approved evaluator version (optional). |

## Endpoints the engine must expose (all require `Authorization: Bearer <token>`)

- `GET /health` → `{status, engineAvailable, engineVersion, researchBaseVersion, modelsLoaded, configSha256, configIntegrity: "ok"|"failed"}` — no paths, secrets or GPU ids.
- `GET /version`
- `POST /v1/jobs` (header `Idempotency-Key: <platformJobId>`), body
  `{platformJobId, authorizationId, assetId, inputUrl (signed, 15 min), inputSha256, requestedEngineVersion, evaluationVersion}` →
  `{engineJobId, platformJobId, status, engineVersion, researchBaseVersion, configSha256}`.
  Resubmitting the same `platformJobId` must return the existing job (200 or 409), never start a second immunization.
- `GET /v1/jobs/:engineJobId` → `{engineJobId, platformJobId, status, stage?, errorCode?, preflightReasonCodes?, manifest?, outputUrl?}`
  - `status` ∈ `QUEUED | VALIDATING | IMMUNIZING | EVALUATING | FINALIZING | COMPLETED | CANCELLED | FAILED_SYSTEM`.
  - Preflight rejections (`NO_FACE`, `MULTIPLE_FACES`, `LOW_RESOLUTION`, `INVALID_IMAGE`, `UNSUPPORTED_FORMAT`) → `FAILED_SYSTEM` + `preflightReasonCodes` (stored as a technical FAIL). `AUTHORIZATION_INVALID` → SYSTEM_ERROR.
  - `COMPLETED` must include the manifest and a short-lived `outputUrl` for the protected PNG.
- `POST /v1/jobs/:engineJobId/cancel`
- `POST /v1/evaluations` (`Idempotency-Key: <reevaluationId>`) body `{platformJobId, reevaluationId, protectedUrl, protectedSha256, evaluationVersion}` → `{engineEvaluationId}`. Evaluator only — must not rerun the optimizer.
- `GET /v1/evaluations/:id` → `{engineEvaluationId, status: QUEUED|EVALUATING|COMPLETED|FAILED_SYSTEM, evaluation?: {protected_asset_sha256, evaluation_version, decision, reason_codes, summary}}`.

## Manifest (required fields; validated before any result is stored)

`eip_job_id, authorization_id, engine_version, research_base_version, config_sha256,
original_asset_sha256, protected_asset_sha256 (null only for FAIL), quality_metrics,
identity_metrics, transform_metrics, held_out_metrics, decision (PASS|LIMITED|FAIL),
reason_codes, warnings, evaluation_version, created_at`, optional `certificate_id`,
optional `summary {visual_quality, transformation_robustness, identity_evaluation}`.

The platform rejects the result (SYSTEM_ERROR) if: the manifest is incomplete, the job/authorization ids differ,
the original hash differs from the upload, the engine/config version differs from the one pinned at submission
or from the expected values, or the downloaded protected file's SHA-256 differs from the manifest.

## Platform worker

`/api/public/hooks/eip-worker` — runs once a minute only while EIP work is pending (armed on enqueue,
disarmed when drained or when the engine is disabled). Atomic claim (`FOR UPDATE SKIP LOCKED`), heartbeat,
stale recovery after 10 min without heartbeat, max 3 attempts, then SYSTEM_ERROR `ENGINE_TIMEOUT`.

## Local development

1. Run the engine service locally on a port (e.g. 8000) with the token set.
2. Expose it to the platform worker (the worker runs in the cloud, so a local engine needs a private HTTPS tunnel).
3. Set `EIP_ENGINE_ENABLED=true`, `EIP_ENGINE_BASE_URL`, `EIP_ENGINE_SERVICE_TOKEN`, and the expected version/config SHA.
