# OpenAI Research & Reasoning Intelligence Layer (Web Scan)

Additive layer only. Existing discovery providers, Crawl4AI extraction, identity verification, database tables, and UI stay exactly as they are. If the AI layer is unavailable, the scan behaves as it does today.

## Where it plugs into the existing pipeline

Current flow inside `src/routes/api/scan.ts` (single handler, ~4.1k lines):

```text
query plan -> YouTube discovery + runFirecrawlDiscoveryMode (line ~3484)
           -> mergedRuns (dedupe by URL, ~line 3900)
           -> EXTRACTION STAGE: extractPages() Crawl4AI + fetch fallback (~3945)
           -> buildReport() -> identity/removal verification (~3750)
           -> persistScanRun() (~3990) -> diagnostics block (~4020)
```

Two insertion points, both wrapped in try/catch:

1. **INSERT A — Research pass**: immediately after the extraction stage and after `buildReport()` produces verified hits, before persistence. Reads the funnel + verified/needs-review leads, asks for coverage gaps, then executes the returned queries through the *existing* `fcSearch` / discovery helpers, merges new raw hits into `mergedRuns`, and re-runs `extractPages()` for the new URLs only. After the merge, `buildReport()` is called once more on the enlarged run set (report building is pure over `mergedRuns`), so verification logic is unchanged and applies to old + new leads identically.
2. **INSERT B — Reasoning pass**: after the (possibly re-run) report and identity verification, before `persistScanRun()`. Annotates existing findings; never creates findings.

Hard cap: initial discovery -> one research pass -> one expansion discovery pass -> one reasoning pass. A module-level guard flag makes recursion impossible.

## Files to create

- `src/lib/scan/openai/client.server.ts` — streaming `/v1/responses` call through the Lovable AI Gateway (`openai/gpt-5.5`, `forceReasoning`, `store: false`, strict `json_schema`), consumed server-side. No timers/aborts; a soft budget guard and single retry on 429/5xx only.
- `src/lib/scan/openai/research-agent.server.ts` — builds the compact target/coverage packet, calls the model, validates output, returns `missing_narratives`, `suggested_platform_queries`, `suggested_local_language_queries`, `coverage_assessment`.
- `src/lib/scan/openai/expansion.server.ts` — query normalization + dedupe against already-executed queries, priority sort (HIGH first), global budget (default 12 expansion queries), concurrency 4, provider-health check, executes via existing `fcSearch`; tags each hit with `queryOrigin: "OPENAI_RESEARCH"`.
- `src/lib/scan/openai/reasoning-agent.server.ts` — builds compact evidence packets (title, canonical URL, platform, date, author, up to ~1200 chars of extracted passages, identity confidence, existing classifier output), batches 6 per call, returns the structured verdict schema.
- `src/lib/scan/openai/evidence-hash.ts` — deterministic SHA-256 over the evidence packet for caching; identical evidence is never re-analyzed.
- `src/lib/scan/openai/types.ts` — shared types incl. `content_type` union (FACTUAL_REPORTING, ALLEGATION, OPINION, CRITICISM, USER_GENERATED_ACCUSATION, SATIRE, HARASSMENT, IMPERSONATION, MANIPULATED_MEDIA, DEEPFAKE, COPYRIGHT_CONCERN, PRIVACY_CONCERN, UNKNOWN), `evidence_basis: "MODEL_SUGGESTED" | "SOURCE_VERIFIED"`, and the AI diagnostics counter shape.

## Files to change

- `src/lib/scan/pipeline-funnel.ts` — add an optional `ai` counter block: `research_status`, `missing_narratives`, `expansion_queries_generated/executed`, `expansion_new_urls`, `reasoning_status`, `evidence_analyzed`, `high_risk`, `medium_risk`, `needs_review`, `ai_failures`, `cache_hits`. Existing keys untouched.
- `src/lib/scan/persist.server.ts` — extend `PersistLeadInput` with optional `query_origin`, `ai_content_type`, `ai_reputation_risk`, `ai_subject_confidence`, `ai_evidence_confidence`, `ai_recommended_action`, `ai_reasoning_summary`, `ai_evidence_basis`. All nullable, so existing writes keep working.
- `src/routes/api/scan.ts` — the two insertion blocks plus `diagnostics.openai = funnel.ai`. No refactor of existing stages.
- Diagnostics UI (the Web Scan diagnostics panel) — one extra "OpenAI Research & Reasoning" section rendering the new counters; falls back to "unavailable" chips when absent.

## Grounding and safety rules enforced in code

- Research output is treated as *search directions only*; its text never enters a finding. Every suggested query is re-run through normal discovery, extraction, and identity verification.
- A reasoning verdict is attached only to a lead that already has a retrieved source; verdicts referencing no evidence id are dropped and counted as `ai_failures`.
- Every conclusion stores its evidence URLs and `evidence_basis`. Without a verified source the lead stays `MODEL_SUGGESTED` and is never promoted.
- No legal conclusions: the model is instructed to output `POTENTIAL_REPUTATION_RISK`, `POTENTIAL_LEGAL_REVIEW`, or `HUMAN_REVIEW_REQUIRED` and never "defamatory"/"illegal".

## Database migration

One additive migration:
- `web_scan_leads`: add nullable `query_origin text default 'PIPELINE'`, `ai_content_type text`, `ai_reputation_risk text`, `ai_subject_confidence int`, `ai_evidence_confidence int`, `ai_recommended_action text`, `ai_evidence_basis text`, `ai_reasoning_summary text`.
- `web_scan_runs`: add nullable `ai_diagnostics jsonb`.
- New `scan_ai_analysis_cache` (evidence_hash pk, verdict jsonb, created_at) with GRANTs to `authenticated`/`service_role`, RLS enabled, service-role-only write policy.

No column drops, no type changes, no policy changes to existing tables.

## Cost / volume control

Per scan, worst case: 1 research call + ceil(verified_leads / 6) reasoning calls, capped at 8 reasoning calls (~48 leads) by default. Evidence packets are truncated text — raw HTML is never sent. Deterministic evidence hashing means repeat scans of unchanged pages cost nothing. Expansion queries capped at 12.

## Failure behavior

Both layers are best-effort: any error, malformed JSON, budget exhaustion, or missing key sets `OPENAI_RESEARCH_UNAVAILABLE` / `OPENAI_REASONING_UNAVAILABLE` in the funnel and the scan continues and returns its normal report.

## Environment

Uses the existing `LOVABLE_API_KEY` (already present) through the AI Gateway — no new secret required. Optional overrides read inside handlers: `OPENAI_SCAN_MODEL`, `SCAN_AI_RESEARCH_ENABLED`, `SCAN_AI_REASONING_ENABLED`, `SCAN_AI_MAX_EXPANSION_QUERIES`.

## Regression risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Second `buildReport()` call double-counts funnel numbers | Build the final report once, after the expansion merge; reset the funnel counters used by report building before the final call. |
| Scan latency grows | Expansion capped and concurrent; reasoning batched; both skippable via env flags. |
| Extraction re-run on already-extracted URLs | Extract only URLs absent from the extracted map. |
| AI failure breaking the response | Every AI block in try/catch with status flags; no throw path into the handler. |
| Persist schema drift | All new columns nullable with defaults; existing insert paths unchanged. |
