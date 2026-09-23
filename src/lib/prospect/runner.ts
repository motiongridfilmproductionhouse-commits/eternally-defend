/**
 * Pre-Enrollment Intelligence — live scan runner.
 *
 * Executes the configured providers for one locked identity and persists every
 * step. The runner is written against ports (store, provider executors, page
 * fetcher, manipulation detector) so the orchestration itself is unit-testable;
 * the production wiring lives in runner-wiring.server.ts.
 *
 * Resumable by design: work is split into small units (one provider query, one
 * detector batch, one analysis stage). A unit is recorded as done by its event
 * row, and every piece of state is re-derived from stored rows at the start of
 * each step — so a scan survives worker restarts and short serverless limits,
 * and never depends on process memory.
 *
 * Honesty rules enforced here:
 *  - a family is only marked scanned when an executor actually ran a query
 *  - platform URLs surfaced by web search keep discovery_method = WEB_SEARCH and
 *    never flip the platform family to "scanned"
 *  - counts only move when a row is written; nothing is predetermined
 *  - identity resolution runs before anything is classified
 *  - media is a "candidate" until a real detector returns a signal
 */

import { contentFingerprint, canonicalizeUrl, stableHash } from "./fingerprint";
import { classifyDiscovery, maskSensitive, type Classification } from "./classify";
import { computeCoverage, type SourceState } from "./coverage";
import {
  resolveIdentity,
  type IdentityTargetProfile,
  type IdentityResolution,
} from "./identity-resolution";
import { planQueries, type PlannedQuery } from "./query-plan";
import {
  SOURCE_FAMILIES,
  platformForUrl,
  type SourceFamily,
  type SourceFamilyKey,
} from "./source-registry";
import {
  providerStatusForFailure,
  type DiscoveryMethod,
  type ProviderStatus,
  type ScanEventInput,
} from "./events";
import {
  analyseScan,
  clusterPropagation,
  riskInputsFromRows,
  type CapabilityRow,
  type DiscoveryRow,
  type FindingRow,
  type ObservationRow,
} from "./analysis";
import {
  computePreliminaryExposure,
  computeVerifiedRisk,
  type RiskScoreResult,
} from "./risk-model";
import { isHostDisabledForFeature } from "@/lib/policy/source-policy";

export const CLASSIFICATION_VERSION = "prospect-classify-v1";

/* ── Ports ────────────────────────────────────────────────────────────────── */

export interface NormalizedHit {
  url: string;
  title?: string | null;
  snippet?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  thumbnailUrl?: string | null;
  mediaKind?: "image" | "video" | null;
  providerResultId?: string | null;
  rank?: number | null;
}

export interface ProviderBatch {
  query: PlannedQuery;
  hits: NormalizedHit[];
}

export interface ProviderExecutor {
  id: string;
  label: string;
  familyKey: SourceFamilyKey;
  method: DiscoveryMethod;
  isConfigured(): boolean;
  /** Runs one planned query. Throws an error with `.kind` (ProviderError) on failure. */
  search(query: PlannedQuery, signal?: AbortSignal): Promise<NormalizedHit[]>;
}

export interface FetchedPage {
  text: string;
  title?: string | null;
  description?: string | null;
  publishedAt?: string | null;
  imageUrl?: string | null;
}

export interface DetectorResult {
  status: "completed" | "no_media" | "error";
  /** 0–100, highest of the detector's manipulation/synthetic scores. */
  score: number | null;
  detail: string;
  mediaUrl?: string | null;
}

export interface ManipulationDetector {
  name: string;
  isConfigured(): boolean;
  analyse(
    item: { url: string; title?: string | null; mediaUrl?: string | null },
    signal?: AbortSignal,
  ): Promise<DetectorResult>;
}

export interface SourceRowPatch {
  state?: SourceState;
  providers?: string[];
  queries_issued?: number;
  raw_results?: number;
  unique_items?: number;
  failure_reason?: string | null;
}

export interface NewDiscovery {
  family_key: string;
  platform: string | null;
  discovery_method: DiscoveryMethod;
  original_url: string;
  canonical_url: string;
  content_fingerprint: string;
  title: string | null;
  snippet: string | null;
  page_excerpt: string | null;
  extraction_status: string;
  author: string | null;
  published_at: string | null;
  retrieved_at: string;
  identity_bucket: IdentityResolution["bucket"];
  identity_confidence: number;
  identity_factors: IdentityResolution["factors"];
  identity_explanation: string;
  classification: string | null;
  classification_version: string;
  thumbnail_url: string | null;
  media_kind: string | null;
}

export interface NewObservation {
  discovery_id: string;
  provider: string;
  provider_result_id: string | null;
  family_key: string;
  query_used: string;
  query_purpose: string;
  discovery_method: DiscoveryMethod;
  result_rank: number | null;
  raw_url: string;
  raw_excerpt: string | null;
  retrieved_at: string;
}

export interface NewFinding {
  discovery_id: string;
  stage_key: string;
  category: string;
  severity: string;
  detection_reason: string;
  confidence: number | null;
  state: "CLASSIFIED" | "NEEDS_HUMAN_REVIEW";
  classification_version: string;
}

export interface NewEvidence {
  finding_id: string;
  source_url: string;
  capture_kind: string;
  extracted_text: string | null;
  content_hash: string | null;
  observed_at: string;
  provenance: Record<string, unknown>;
}

export interface StoredSourceRow {
  family_key: string;
  state: SourceState;
  weight_class: string;
  direct_access: boolean;
  providers?: string[] | null;
  queries_issued?: number | null;
  raw_results?: number | null;
  unique_items?: number | null;
}

export interface ProspectStore {
  getScanStatus(): Promise<string>;
  updateScan(patch: Record<string, unknown>): Promise<void>;
  initSources(
    rows: Array<{
      family_key: string;
      family_label: string;
      direct_access: boolean;
      weight_class: string;
      state: SourceState;
      failure_reason: string | null;
    }>,
  ): Promise<void>;
  updateSource(familyKey: string, patch: SourceRowPatch): Promise<void>;
  appendEvent(event: ScanEventInput): Promise<void>;
  /** Completed work units, read back from event rows (detail.unit). */
  listUnitRecords(): Promise<Array<{ unit: string; detail: Record<string, unknown> }>>;
  insertDiscovery(row: NewDiscovery): Promise<string | null>;
  findDiscoveryId(canonicalUrl: string): Promise<string | null>;
  insertObservation(row: NewObservation): Promise<void>;
  insertFinding(row: NewFinding): Promise<string | null>;
  insertEvidence(row: NewEvidence): Promise<void>;
  upsertCapability(row: CapabilityRow): Promise<void>;
  insertCluster(row: {
    cluster_key: string;
    member_count: number;
    earliest_discovery_id: string;
    members: Array<{
      discovery_id: string;
      is_earliest_discovered: boolean;
      link_evidence: Record<string, unknown>;
    }>;
  }): Promise<void>;
  insertRiskScore(result: RiskScoreResult): Promise<void>;
  listSources(): Promise<StoredSourceRow[]>;
  listDiscoveries(): Promise<DiscoveryRow[]>;
  listFindings(): Promise<FindingRow[]>;
  listObservations(): Promise<ObservationRow[]>;
  listCapabilities(): Promise<CapabilityRow[]>;
}

export interface RunnerPorts {
  store: ProspectStore;
  executors: ProviderExecutor[];
  fetchPage: (url: string, signal?: AbortSignal) => Promise<FetchedPage | null>;
  detector: ManipulationDetector | null;
  now?: () => Date;
  signal?: AbortSignal;
  limits?: Partial<RunnerLimits>;
}

export interface RunnerLimits {
  maxPageFetches: number;
  maxDetectorItems: number;
  maxHitsPerQuery: number;
  pageFetchConcurrency: number;
  detectorBatch: number;
}

const DEFAULT_LIMITS: RunnerLimits = {
  maxPageFetches: 60,
  maxDetectorItems: 12,
  maxHitsPerQuery: 10,
  pageFetchConcurrency: 4,
  detectorBatch: 3,
};

export interface RunnerInput {
  target: IdentityTargetProfile;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 60);
  }
}

/** Only public http(s) URLs are ever stored or fetched. */
export function isPublicHttpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return false;
  if (/^\[?[0-9a-f:]+\]?$/.test(host) && host.includes(":")) return false; // IPv6 literal
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return false;
  }
  return true;
}

function errorKind(error: unknown): string | null {
  if (error && typeof error === "object" && "kind" in error)
    return String((error as { kind: unknown }).kind);
  return null;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 220);
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(size, queue.length)) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next !== undefined) await fn(next);
    }
  });
  await Promise.all(workers);
}

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const MEDIA_URL = /\.(?:avif|gif|jpe?g|png|webp|mp4|webm|mov)(?:$|[?#])/i;

/* ── Runner ───────────────────────────────────────────────────────────────── */

export interface RunnerResult {
  done: boolean;
  unitsRun: number;
  coverage?: string;
  preliminary?: string;
  verified?: string;
}

const FATAL_PROVIDER: ProviderStatus[] = ["CREDIT_EXHAUSTED", "AUTH_FAILED", "RATE_LIMITED"];

type Unit =
  | {
      id: string;
      kind: "query";
      family: SourceFamily;
      executor: ProviderExecutor;
      query: PlannedQuery;
    }
  | { id: string; kind: "family_final"; family: SourceFamily; executors: ProviderExecutor[] }
  | { id: string; kind: "stage"; stage: "text" | "search_reputation" | "propagation" | "finalize" }
  | { id: string; kind: "detector_batch"; index: number }
  | { id: string; kind: "detector_final" };

function parseProviderStatuses(list: string[] | null | undefined): Map<string, ProviderStatus> {
  const out = new Map<string, ProviderStatus>();
  for (const entry of list ?? []) {
    const i = entry.lastIndexOf(":");
    if (i > 0) out.set(entry.slice(0, i), entry.slice(i + 1) as ProviderStatus);
  }
  return out;
}

/**
 * Run as much of the scan as fits in `budgetMs`, then return. Call again until
 * `done`. Every step re-derives its state from stored rows.
 */
export async function runProspectScanStep(
  ports: RunnerPorts,
  input: RunnerInput,
  opts: { budgetMs?: number } = {},
): Promise<RunnerResult> {
  const { store } = ports;
  const limits = { ...DEFAULT_LIMITS, ...(ports.limits ?? {}) };
  const now = () => (ports.now ? ports.now() : new Date()).toISOString();
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const signal = ports.signal;
  const target = input.target;
  const emit = (e: ScanEventInput) => store.appendEvent(e);
  let unitsRun = 0;

  const records = await store.listUnitRecords();
  const done = new Set(records.map((r) => r.unit));
  const unitDetail = (id: string) => records.find((r) => r.unit === id)?.detail ?? {};

  const executorsByFamily = new Map<SourceFamilyKey, ProviderExecutor[]>();
  for (const ex of ports.executors) {
    if (!executorsByFamily.has(ex.familyKey)) executorsByFamily.set(ex.familyKey, []);
    executorsByFamily.get(ex.familyKey)!.push(ex);
  }
  const familyPlan = SOURCE_FAMILIES.map((family) => {
    const configured = (executorsByFamily.get(family.key) ?? []).filter((e) => e.isConfigured());
    let state: SourceState = "not_scanned";
    let reason: string | null = null;
    if (!family.policyEnabled) {
      state = "policy_disabled";
      reason = family.policyReason ?? "Disabled by product policy";
    } else if (!family.directAccess) {
      state = "unavailable";
      reason = family.unavailableReason ?? "No permitted API access configured";
    } else if (configured.length === 0) {
      state = "unavailable";
      reason = "No configured provider for this source";
    }
    return { family, configured, state, reason };
  });

  /* ── init (once) ───────────────────────────────────────────────────────── */
  if (!done.has("init")) {
    await store.initSources(
      familyPlan.map((p) => ({
        family_key: p.family.key,
        family_label: p.family.label,
        direct_access: p.family.directAccess,
        weight_class: p.family.weightClass,
        state: p.state,
        failure_reason: p.reason,
      })),
    );
    await store.updateScan({ status: "running", stage: "discovery", started_at: now() });
    for (const p of familyPlan) {
      if (p.state === "policy_disabled") {
        await emit({
          type: "POLICY_EXCLUDED",
          level: "info",
          familyKey: p.family.key,
          message: `${p.family.label}: disabled by policy`,
          detail: { reason: p.reason },
        });
      } else if (p.state === "unavailable") {
        await emit({
          type: "SOURCE_UNAVAILABLE",
          level: "warning",
          familyKey: p.family.key,
          message: `${p.family.label}: unavailable — not scanned`,
          detail: { reason: p.reason },
        });
      }
    }
    await emit({
      type: "SCAN_STARTED",
      level: "info",
      stage: "discovery",
      message: `Scan started for ${target.name}`,
      detail: { unit: "init", families: familyPlan.length },
    });
    done.add("init");
    unitsRun++;
  }

  /* ── state re-derived from stored rows ─────────────────────────────────── */
  const sourceRows = new Map((await store.listSources()).map((r) => [r.family_key, r]));
  const statuses = new Map<string, Map<string, ProviderStatus>>();
  for (const [key, row] of sourceRows) statuses.set(key, parseProviderStatuses(row.providers));
  const knownDiscoveries = new Map<string, string>();
  let pagesUsed = 0;
  for (const d of await store.listDiscoveries()) {
    knownDiscoveries.set(d.canonical_url, d.id);
    if (d.extraction_status === "fetched" || d.extraction_status === "fetch_failed") pagesUsed++;
  }

  const runnable = familyPlan.filter((p) => p.state === "not_scanned");
  const queriesFor = new Map(
    runnable.map((p) => [
      p.family.key,
      planQueries(p.family.key, {
        name: target.name,
        aliases: (target.aliases ?? []).filter((a): a is string => Boolean(a)),
        profession: target.profession,
        organization: target.organization,
        countryRegion: target.countryRegion,
        knownWorks: (target.knownWorks ?? []).filter((w): w is string => Boolean(w)),
      }),
    ]),
  );

  // Round-robin across families so every source lights up early.
  const plan: Unit[] = [];
  const maxQ = Math.max(0, ...Array.from(queriesFor.values()).map((q) => q.length));
  for (let qi = 0; qi < maxQ; qi++) {
    for (const p of runnable) {
      const q = queriesFor.get(p.family.key)![qi];
      if (!q) continue;
      for (const ex of p.configured) {
        plan.push({
          id: `q|${p.family.key}|${ex.id}|${qi}`,
          kind: "query",
          family: p.family,
          executor: ex,
          query: q,
        });
      }
    }
  }
  for (const p of runnable)
    plan.push({
      id: `final|${p.family.key}`,
      kind: "family_final",
      family: p.family,
      executors: p.configured,
    });

  const persistStatuses = async (familyKey: string, extra: SourceRowPatch = {}) => {
    const map = statuses.get(familyKey) ?? new Map();
    const exs = runnable.find((p) => p.family.key === familyKey)?.configured ?? [];
    await store.updateSource(familyKey, {
      providers: exs.map((e) => `${e.id}:${map.get(e.id) ?? "CONNECTING"}`),
      ...extra,
    });
  };

  const discoveryCountByFamily = async () => {
    const counts = new Map<string, number>();
    for (const d of await store.listDiscoveries())
      counts.set(d.family_key, (counts.get(d.family_key) ?? 0) + 1);
    return counts;
  };

  /** Providers that answered at least one query, per family (stored events + this step). */
  const answeredBy = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.unit.startsWith("q|") && r.detail.type === "PROVIDER_RESULT") {
      const fam = r.unit.split("|")[1]!;
      if (!answeredBy.has(fam)) answeredBy.set(fam, new Set());
      answeredBy.get(fam)!.add(String(r.detail.provider));
    }
  }

  /* ── discovery helpers ─────────────────────────────────────────────────── */
  const inFlight = new Map<string, Promise<string | null>>();

  const prepareDiscovery = async (
    family: SourceFamily,
    executor: ProviderExecutor,
    hit: NormalizedHit,
    page: FetchedPage | null,
    extraction: string,
  ): Promise<string | null> => {
    const canonical = canonicalizeUrl(hit.url);
    const attributed = platformForUrl(hit.url);
    const platform =
      attributed?.platform ??
      (family.key === "youtube" ? "YouTube" : family.key === "encyclopaedic" ? "Wikipedia" : "Web");
    const mediaKind =
      hit.mediaKind ??
      (family.key === "youtube" ? "video" : MEDIA_URL.test(hit.url) ? "image" : null);
    const identity = resolveIdentity(target, {
      url: hit.url,
      title: page?.title ?? hit.title,
      snippet: hit.snippet,
      description: page?.description,
      author: hit.author,
      platform,
      pageText: page?.text ?? null,
    });
    const row: NewDiscovery = {
      family_key: family.key,
      platform,
      discovery_method: executor.method,
      original_url: hit.url,
      canonical_url: canonical,
      content_fingerprint: page ? contentFingerprint({ title: page.title, text: page.text }) : "",
      title: (page?.title ?? hit.title ?? null)?.slice(0, 500) ?? null,
      snippet: hit.snippet?.slice(0, 1000) ?? null,
      page_excerpt: page?.text ? maskSensitive(page.text.slice(0, 1500)) : null,
      extraction_status: extraction,
      author: hit.author ?? null,
      published_at: toIso(hit.publishedAt) ?? toIso(page?.publishedAt),
      retrieved_at: now(),
      identity_bucket: identity.bucket,
      identity_confidence: identity.confidence,
      identity_factors: identity.factors,
      identity_explanation: identity.explanation,
      classification: null,
      classification_version: CLASSIFICATION_VERSION,
      thumbnail_url: hit.thumbnailUrl ?? page?.imageUrl ?? null,
      media_kind: mediaKind,
    };
    const id = await store.insertDiscovery(row);
    if (!id) return store.findDiscoveryId(canonical);
    knownDiscoveries.set(canonical, id);

    await emit({
      type: "CANDIDATE_DISCOVERED",
      level: "info",
      familyKey: family.key,
      message: `Candidate discovered · ${hostOf(hit.url)}`,
      detail: {
        discovery_id: id,
        url: canonical,
        platform,
        discovery_method: executor.method,
        provider: executor.id,
      },
    });
    await emit({
      type:
        identity.bucket === "MATCHED"
          ? "IDENTITY_MATCHED"
          : identity.bucket === "UNRELATED"
            ? "IDENTITY_UNRELATED"
            : "IDENTITY_REVIEW_REQUIRED",
      level:
        identity.bucket === "MATCHED"
          ? "success"
          : identity.bucket === "UNRELATED"
            ? "debug"
            : "warning",
      familyKey: family.key,
      stage: "identity",
      message: `${
        identity.bucket === "MATCHED"
          ? "Identity matched"
          : identity.bucket === "UNRELATED"
            ? "Unrelated — excluded"
            : "Identity review required"
      } · ${hostOf(hit.url)}`,
      detail: {
        discovery_id: id,
        bucket: identity.bucket,
        confidence: identity.confidence,
        explanation: identity.explanation,
      },
    });
    if (identity.bucket !== "UNRELATED") await classifyAndStore(id, row, platform, page, executor);
    return id;
  };

  const ingestHits = async (
    family: SourceFamily,
    executor: ProviderExecutor,
    q: PlannedQuery,
    hits: NormalizedHit[],
  ) => {
    // 1. Fetch pages (bounded, parallel) for canonical URLs not yet stored.
    const pages = new Map<string, { page: FetchedPage | null; extraction: string }>();
    const toFetch: NormalizedHit[] = [];
    for (const hit of hits) {
      const canonical = canonicalizeUrl(hit.url);
      if (knownDiscoveries.has(canonical) || pages.has(canonical)) continue;
      const attributed = platformForUrl(hit.url);
      const platformFamily = attributed
        ? SOURCE_FAMILIES.find((f) => f.key === attributed.familyKey)
        : null;
      const mayFetch =
        !platformFamily || (platformFamily.directAccess && platformFamily.policyEnabled);
      const mediaKind =
        hit.mediaKind ??
        (family.key === "youtube" ? "video" : MEDIA_URL.test(hit.url) ? "image" : null);
      if (!mayFetch)
        pages.set(canonical, { page: null, extraction: "not_fetched_platform_unavailable" });
      else if (mediaKind === "image" && MEDIA_URL.test(hit.url))
        pages.set(canonical, { page: null, extraction: "media_file" });
      else if (family.key === "youtube")
        pages.set(canonical, { page: null, extraction: "platform_api_metadata" });
      else if (!isPublicHttpUrl(hit.url))
        pages.set(canonical, { page: null, extraction: "not_fetched_unsafe_url" });
      else if (pagesUsed + toFetch.length >= limits.maxPageFetches)
        pages.set(canonical, { page: null, extraction: "not_fetched_budget" });
      else {
        pages.set(canonical, { page: null, extraction: "pending" });
        toFetch.push(hit);
      }
    }
    await pool(toFetch, limits.pageFetchConcurrency, async (hit) => {
      const canonical = canonicalizeUrl(hit.url);
      pagesUsed++;
      let page: FetchedPage | null = null;
      try {
        page = await ports.fetchPage(hit.url, signal);
      } catch {
        page = null;
      }
      pages.set(canonical, { page, extraction: page ? "fetched" : "fetch_failed" });
    });

    // 2. Store discoveries + one observation per provider sighting, in rank order.
    let rank = 0;
    for (const hit of hits) {
      rank++;
      const canonical = canonicalizeUrl(hit.url);
      let discoveryId = knownDiscoveries.get(canonical) ?? null;
      if (!discoveryId) {
        let pending = inFlight.get(canonical);
        if (!pending) {
          const prepared = pages.get(canonical) ?? { page: null, extraction: "not_fetched" };
          pending = prepareDiscovery(family, executor, hit, prepared.page, prepared.extraction);
          inFlight.set(canonical, pending);
        }
        discoveryId = await pending;
      }
      if (!discoveryId) continue;
      await store.insertObservation({
        discovery_id: discoveryId,
        provider: executor.id,
        provider_result_id: hit.providerResultId ?? null,
        family_key: family.key,
        query_used: q.query,
        query_purpose: q.purpose,
        discovery_method: executor.method,
        result_rank: hit.rank ?? rank,
        raw_url: hit.url,
        raw_excerpt: (hit.snippet ?? hit.title ?? "").slice(0, 500) || null,
        retrieved_at: now(),
      });
    }
  };

  let findingCount = 0;
  const storeFinding = async (
    discoveryId: string,
    row: Pick<
      NewDiscovery,
      | "original_url"
      | "page_excerpt"
      | "snippet"
      | "content_fingerprint"
      | "discovery_method"
      | "retrieved_at"
    >,
    c: Pick<Classification, "stageKey" | "category" | "severity" | "reason">,
    state: NewFinding["state"],
    extra: {
      confidence?: number | null;
      provider?: string;
      captureKind?: string;
      evidenceText?: string | null;
    } = {},
  ) => {
    const findingId = await store.insertFinding({
      discovery_id: discoveryId,
      stage_key: c.stageKey,
      category: c.category,
      severity: String(c.severity),
      detection_reason: c.reason,
      confidence: extra.confidence ?? null,
      state,
      classification_version: CLASSIFICATION_VERSION,
    });
    if (!findingId) return;
    findingCount++;
    const text = extra.evidenceText ?? row.page_excerpt ?? row.snippet ?? null;
    await store.insertEvidence({
      finding_id: findingId,
      source_url: row.original_url,
      capture_kind:
        extra.captureKind ?? (row.page_excerpt ? "page_text_extract" : "search_snippet"),
      extracted_text: text ? maskSensitive(text) : null,
      content_hash: text ? stableHash(text) : null,
      observed_at: now(),
      provenance: {
        discovery_id: discoveryId,
        discovery_method: row.discovery_method,
        provider: extra.provider ?? null,
        retrieved_at: row.retrieved_at,
        content_fingerprint: row.content_fingerprint || null,
        classification_version: CLASSIFICATION_VERSION,
      },
    });
    await emit({
      type: "ITEM_CLASSIFIED",
      level: state === "NEEDS_HUMAN_REVIEW" ? "warning" : "info",
      stage: c.stageKey,
      message: `${c.category} · ${hostOf(row.original_url)}`,
      detail: {
        finding_id: findingId,
        discovery_id: discoveryId,
        stage: c.stageKey,
        category: c.category,
        severity: c.severity,
      },
    });
    await emit({
      type: "EVIDENCE_CAPTURED",
      level: "debug",
      stage: c.stageKey,
      message: `Evidence captured · ${hostOf(row.original_url)}`,
      detail: { finding_id: findingId },
    });
  };

  const classifyAndStore = async (
    discoveryId: string,
    row: NewDiscovery,
    platform: string,
    page: FetchedPage | null,
    executor: ProviderExecutor,
  ) => {
    const classifications = classifyDiscovery({
      url: row.original_url,
      platform,
      title: row.title,
      snippet: row.snippet,
      pageText: page?.text ?? null,
      isMedia: Boolean(row.media_kind),
      searchRank: null, // search reputation is computed from observations after discovery
      targetName: target.name,
    });
    for (const c of classifications) {
      if (c.stageKey === "ai_manipulation" || c.stageKey === "search_reputation") continue;
      // Existing product rule: Reddit is excluded from impersonation discovery.
      if (
        c.stageKey === "impersonation" &&
        isHostDisabledForFeature("impersonation_discovery", row.original_url)
      )
        continue;
      await storeFinding(discoveryId, row, c, "NEEDS_HUMAN_REVIEW", { provider: executor.id });
    }
    const profile = profileHandle(row.original_url);
    const known = (target.knownHandles ?? [])
      .map((h) =>
        String(h ?? "")
          .replace(/^@/, "")
          .toLowerCase(),
      )
      .filter(Boolean);
    if (
      profile &&
      known.length > 0 &&
      !known.includes(profile.handle.toLowerCase()) &&
      !isHostDisabledForFeature("impersonation_discovery", row.original_url) &&
      !classifications.some((c) => c.stageKey === "impersonation")
    ) {
      await storeFinding(
        discoveryId,
        row,
        {
          stageKey: "impersonation",
          category: "Profile using the name — ownership unverified",
          severity: 5,
          reason: `${profile.platform} profile @${profile.handle} is not one of the known official handles (${known.map((h) => `@${h}`).join(", ")})`,
        },
        "NEEDS_HUMAN_REVIEW",
        { provider: executor.id },
      );
    }
  };

  // Every step makes progress: the first unit always runs, later ones only within budget.
  const timeLeft = () => !signal?.aborted && (unitsRun === 0 || Date.now() < deadline);

  /* ── discovery units ───────────────────────────────────────────────────── */
  for (const unit of plan) {
    if (done.has(unit.id)) continue;
    if (!timeLeft()) return { done: false, unitsRun };

    if (unit.kind === "query") {
      const famKey = unit.family.key;
      const famStatuses = statuses.get(famKey) ?? new Map<string, ProviderStatus>();
      statuses.set(famKey, famStatuses);
      const current = famStatuses.get(unit.executor.id);
      if (current && FATAL_PROVIDER.includes(current)) {
        // Provider already failed permanently in this scan: this query is skipped, visibly.
        await emit({
          type: "PROVIDER_FAILED",
          level: "debug",
          familyKey: famKey,
          message: `${unit.executor.label}: skipped (${current.toLowerCase().replace(/_/g, " ")})`,
          detail: { unit: unit.id, provider: unit.executor.id, status: current, skipped: true },
        });
        done.add(unit.id);
        continue;
      }
      const row = sourceRows.get(famKey);
      if (!row || row.state === "not_scanned") {
        for (const ex of runnable.find((p) => p.family.key === famKey)?.configured ?? []) {
          famStatuses.set(ex.id, "CONNECTING");
          await emit({
            type: "PROVIDER_STARTED",
            level: "info",
            familyKey: famKey,
            message: `Searching ${unit.family.label} via ${ex.label}`,
            detail: { provider: ex.id },
          });
        }
        await persistStatuses(famKey, { state: "scanning" });
        sourceRows.set(famKey, {
          ...(row ?? {
            family_key: famKey,
            weight_class: unit.family.weightClass,
            direct_access: true,
          }),
          state: "scanning",
        });
      }
      famStatuses.set(unit.executor.id, "SEARCHING");
      let hits: NormalizedHit[] = [];
      let failed: ProviderStatus | null = null;
      let failMessage = "";
      try {
        hits = (await unit.executor.search(unit.query, signal ?? AbortSignal.timeout(15_000)))
          .filter((h) => h.url && isPublicHttpUrl(h.url))
          .slice(0, limits.maxHitsPerQuery);
      } catch (error) {
        failed = providerStatusForFailure(errorKind(error));
        failMessage = errorMessage(error);
      }
      if (failed) {
        famStatuses.set(unit.executor.id, failed);
        const prev = sourceRows.get(famKey);
        await persistStatuses(famKey, {
          queries_issued: (prev?.queries_issued ?? 0) + 1,
          failure_reason: `${unit.executor.label}: ${failed}`,
        });
        sourceRows.set(famKey, { ...prev!, queries_issued: (prev?.queries_issued ?? 0) + 1 });
        await emit({
          type: "PROVIDER_FAILED",
          level: "error",
          familyKey: famKey,
          message: `${unit.executor.label}: ${failed.replace(/_/g, " ").toLowerCase()}`,
          detail: {
            unit: unit.id,
            provider: unit.executor.id,
            status: failed,
            error: failMessage,
            query: unit.query.query,
          },
        });
      } else {
        if (hits.length) {
          await emit({
            type: "IDENTITY_RESOLUTION_STARTED",
            level: "info",
            familyKey: famKey,
            stage: "identity",
            message: `Resolving identity for ${hits.length} candidate${hits.length === 1 ? "" : "s"} from ${unit.executor.label}`,
            detail: { provider: unit.executor.id },
          });
        }
        await ingestHits(unit.family, unit.executor, unit.query, hits);
        if (!answeredBy.has(famKey)) answeredBy.set(famKey, new Set());
        answeredBy.get(famKey)!.add(unit.executor.id);
        const prev = sourceRows.get(famKey);
        const counts = await discoveryCountByFamily();
        const patch = {
          queries_issued: (prev?.queries_issued ?? 0) + 1,
          raw_results: (prev?.raw_results ?? 0) + hits.length,
          unique_items: counts.get(famKey) ?? 0,
        };
        await persistStatuses(famKey, patch);
        sourceRows.set(famKey, { ...prev!, ...patch });
        await emit({
          type: "PROVIDER_RESULT",
          level: "info",
          familyKey: famKey,
          message: `${unit.executor.label} returned ${hits.length} candidate${hits.length === 1 ? "" : "s"} for ${unit.query.query}`,
          detail: {
            unit: unit.id,
            provider: unit.executor.id,
            query: unit.query.query,
            purpose: unit.query.purpose,
            count: hits.length,
          },
        });
      }
      done.add(unit.id);
      unitsRun++;
      continue;
    }

    if (unit.kind === "family_final") {
      const famKey = unit.family.key;
      const pendingQueries = plan.some(
        (u) => u.kind === "query" && u.family.key === famKey && !done.has(u.id),
      );
      if (pendingQueries) continue;
      const famStatuses = statuses.get(famKey) ?? new Map<string, ProviderStatus>();
      // A provider that answered at least one query completed; otherwise its failure stands.
      const answered = answeredBy.get(famKey) ?? new Set<string>();
      for (const ex of unit.executors) {
        const st = famStatuses.get(ex.id);
        if (answered.has(ex.id) && !(st && FATAL_PROVIDER.includes(st)))
          famStatuses.set(ex.id, "COMPLETE");
        else if (!answered.has(ex.id) && (!st || st === "SEARCHING" || st === "CONNECTING"))
          famStatuses.set(ex.id, "PROVIDER_ERROR");
      }
      const anyOk = unit.executors.some((ex) => answered.has(ex.id));
      const raw = sourceRows.get(famKey)?.raw_results ?? 0;
      const finalState: SourceState = anyOk
        ? raw > 0
          ? "results_found"
          : "no_results"
        : "provider_error";
      const failures = unit.executors
        .filter((ex) => famStatuses.get(ex.id) !== "COMPLETE")
        .map((ex) => `${ex.label}: ${famStatuses.get(ex.id)}`);
      await persistStatuses(famKey, {
        state: finalState,
        failure_reason: failures.length ? failures.join("; ") : null,
      });
      for (const ex of unit.executors) {
        const st = famStatuses.get(ex.id) ?? "PROVIDER_ERROR";
        await emit({
          type: st === "COMPLETE" ? "PROVIDER_COMPLETED" : "PROVIDER_FAILED",
          level: st === "COMPLETE" ? "success" : "error",
          familyKey: famKey,
          message: `${ex.label}: ${st === "COMPLETE" ? "complete" : st.replace(/_/g, " ").toLowerCase()}`,
          detail: { provider: ex.id, status: st },
        });
      }
      await emit({
        type: "SOURCE_COMPLETED",
        level: finalState === "provider_error" ? "error" : "success",
        familyKey: famKey,
        message: `${unit.family.label}: ${finalState === "results_found" ? `${sourceRows.get(famKey)?.unique_items ?? 0} unique items` : finalState.replace(/_/g, " ")}`,
        detail: { unit: unit.id, state: finalState },
      });
      done.add(unit.id);
      unitsRun++;
    }
  }

  /* ── 01 Deepfake & AI manipulation ─────────────────────────────────────── */
  const discoveriesNow = await store.listDiscoveries();
  const byId = new Map(discoveriesNow.map((d) => [d.id, d]));
  const media = discoveriesNow
    .filter(
      (d) =>
        d.media_kind &&
        d.identity_bucket === "MATCHED" &&
        !isHostDisabledForFeature("deepfake_intel", d.original_url),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const detectorReady = Boolean(ports.detector && ports.detector.isConfigured());
  const toAnalyse = media.slice(0, limits.maxDetectorItems);
  const batches = detectorReady ? Math.ceil(toAnalyse.length / limits.detectorBatch) : 0;

  if (!done.has("stage|ai_manipulation")) {
    await store.updateScan({ stage: "ai_manipulation" });
    for (let b = 0; b < batches; b++) {
      const id = `stage|ai_manipulation|batch|${b}`;
      if (done.has(id)) continue;
      if (!timeLeft()) return { done: false, unitsRun };
      if (b === 0) {
        await emit({
          type: "STAGE_STARTED",
          stage: "ai_manipulation",
          level: "info",
          message: `Analysing ${toAnalyse.length} identity-matched media candidate${toAnalyse.length === 1 ? "" : "s"} with ${ports.detector!.name}`,
        });
      }
      let analysed = 0;
      let noMedia = 0;
      let errors = 0;
      for (const d of toAnalyse.slice(b * limits.detectorBatch, (b + 1) * limits.detectorBatch)) {
        let result: DetectorResult;
        try {
          result = await ports.detector!.analyse(
            {
              url: d.original_url,
              title: d.title,
              mediaUrl:
                d.media_kind === "image" && MEDIA_URL.test(d.original_url)
                  ? d.original_url
                  : (d.thumbnail_url ?? null),
            },
            signal,
          );
        } catch (error) {
          result = { status: "error", score: null, detail: errorMessage(error) };
        }
        if (result.status === "no_media") noMedia++;
        if (result.status === "error") errors++;
        if (result.status !== "completed") continue;
        analysed++;
        if (typeof result.score === "number" && result.score >= 70) {
          await storeFinding(
            d.id,
            {
              original_url: d.original_url,
              page_excerpt: null,
              snippet: d.snippet,
              content_fingerprint: d.content_fingerprint,
              discovery_method: d.discovery_method as DiscoveryMethod,
              retrieved_at: d.retrieved_at,
            },
            {
              stageKey: "ai_manipulation",
              category: "Potential manipulation signal",
              severity: result.score >= 90 ? 8 : 6,
              reason: `Potential manipulation detected — requires verification. ${ports.detector!.name}: ${result.detail}`,
            },
            "NEEDS_HUMAN_REVIEW",
            {
              confidence: Math.round(result.score),
              provider: ports.detector!.name,
              captureKind: "media_analysis",
              evidenceText: `${result.detail}${result.mediaUrl ? ` · media: ${result.mediaUrl}` : ""}`,
            },
          );
        }
      }
      await emit({
        type: "CATEGORY_UPDATED",
        stage: "ai_manipulation",
        level: "info",
        message: `Media analysis batch ${b + 1}/${batches}: ${analysed} analysed`,
        detail: { unit: id, analysed, noMedia, errors },
      });
      records.push({ unit: id, detail: { analysed, noMedia, errors } });
      done.add(id);
      unitsRun++;
    }
    if (!timeLeft()) return { done: false, unitsRun };
    if (!detectorReady) {
      await store.upsertCapability({
        analysis_key: "ai_manipulation",
        status: "unavailable",
        reason: "No AI-manipulation detector is configured for this environment",
        candidates_considered: media.length,
      });
      await emit({
        type: "ANALYSIS_UNAVAILABLE",
        stage: "ai_manipulation",
        level: "warning",
        message: `${media.length} media candidate${media.length === 1 ? "" : "s"} discovered · AI manipulation analysis unavailable`,
      });
    } else {
      let analysed = 0;
      let noMedia = 0;
      let errors = 0;
      for (let b = 0; b < batches; b++) {
        const det = unitDetail(`stage|ai_manipulation|batch|${b}`);
        const local =
          records.find((r) => r.unit === `stage|ai_manipulation|batch|${b}`)?.detail ?? det;
        analysed += Number(local.analysed ?? 0);
        noMedia += Number(local.noMedia ?? 0);
        errors += Number(local.errors ?? 0);
      }
      await store.upsertCapability({
        analysis_key: "ai_manipulation",
        status: analysed > 0 ? "ran" : "unavailable",
        reason:
          analysed > 0
            ? `${ports.detector!.name} analysed ${analysed} of ${media.length} media candidate(s)` +
              (noMedia ? ` · ${noMedia} without accessible media` : "") +
              (errors ? ` · ${errors} detector error(s)` : "") +
              (media.length > limits.maxDetectorItems
                ? ` · capped at ${limits.maxDetectorItems}`
                : "")
            : media.length === 0
              ? "No identity-matched media candidates to analyse"
              : `${ports.detector!.name} could not analyse any candidate (${noMedia} without accessible media, ${errors} error(s))`,
        candidates_considered: media.length,
      });
    }
    await emit({
      type: "STAGE_COMPLETED",
      stage: "ai_manipulation",
      level: "success",
      message: "Deepfake & AI manipulation analysis complete",
      detail: { unit: "stage|ai_manipulation" },
    });
    done.add("stage|ai_manipulation");
    unitsRun++;
  }

  /* ── 02–04 text stages were classified as items arrived ────────────────── */
  if (!done.has("stage|text")) {
    if (!timeLeft()) return { done: false, unitsRun };
    const considered = discoveriesNow.filter((d) => d.identity_bucket !== "UNRELATED").length;
    const textCapabilities: Array<[string, string, string]> = [
      [
        "harmful_content",
        "Rule-based text classification of retrieved pages and search snippets (prospect-classify-v1)",
        "Reputation analysis complete",
      ],
      [
        "impersonation",
        "Text signals plus profile-URL checks against staff-supplied official handles; no image-reuse analysis",
        "Identity analysis complete",
      ],
      [
        "privacy_exposure",
        "Pattern checks on retrieved public page text; sensitive values are masked",
        "Privacy analysis complete",
      ],
    ];
    for (const [key, reason, message] of textCapabilities) {
      await store.upsertCapability({
        analysis_key: key,
        status: "ran",
        reason,
        candidates_considered: considered,
      });
      await emit({ type: "STAGE_COMPLETED", stage: key, level: "success", message });
    }
    await emit({
      type: "CATEGORY_UPDATED",
      level: "debug",
      message: "Text stages finalised",
      detail: { unit: "stage|text" },
    });
    done.add("stage|text");
    unitsRun++;
  }

  /* ── 05 Search reputation (plain-name query ranks only) ────────────────── */
  const observations = await store.listObservations();
  if (!done.has("stage|search_reputation")) {
    if (!timeLeft()) return { done: false, unitsRun };
    await store.updateScan({ stage: "search_reputation" });
    const ranks = new Map<string, number>();
    for (const o of observations) {
      if (o.query_purpose !== "identity_primary" || typeof o.result_rank !== "number") continue;
      const prev = ranks.get(o.discovery_id);
      if (prev === undefined || o.result_rank < prev) ranks.set(o.discovery_id, o.result_rank);
    }
    let searchAnalysed = 0;
    for (const [discoveryId, rank] of ranks) {
      const d = byId.get(discoveryId);
      if (!d || d.identity_bucket === "UNRELATED") continue;
      const c = classifyDiscovery({
        url: d.original_url,
        title: d.title,
        snippet: d.snippet,
        searchRank: rank,
        targetName: target.name,
      }).find((x) => x.stageKey === "search_reputation");
      if (!c) continue;
      searchAnalysed++;
      await storeFinding(
        discoveryId,
        {
          original_url: d.original_url,
          page_excerpt: null,
          snippet: d.snippet,
          content_fingerprint: d.content_fingerprint,
          discovery_method: d.discovery_method as DiscoveryMethod,
          retrieved_at: d.retrieved_at,
        },
        c,
        c.searchSentiment === "potential_risk" ? "NEEDS_HUMAN_REVIEW" : "CLASSIFIED",
        { captureKind: "search_result" },
      );
    }
    await store.upsertCapability({
      analysis_key: "search_reputation",
      status: ranks.size > 0 ? "ran" : "unavailable",
      reason:
        ranks.size > 0
          ? `${searchAnalysed} ranked result(s) for the plain-name query analysed`
          : "No ranked search results were returned for the plain-name query",
      candidates_considered: ranks.size,
    });
    await emit({
      type: "STAGE_COMPLETED",
      stage: "search_reputation",
      level: "success",
      message: `Search reputation · ${searchAnalysed} ranked result(s) analysed`,
      detail: { unit: "stage|search_reputation" },
    });
    done.add("stage|search_reputation");
    unitsRun++;
  }

  /* ── 06 Propagation ────────────────────────────────────────────────────── */
  const clusters = clusterPropagation(discoveriesNow);
  if (!done.has("stage|propagation")) {
    if (!timeLeft()) return { done: false, unitsRun };
    await store.updateScan({ stage: "propagation" });
    for (const cluster of clusters) {
      await store.insertCluster({
        cluster_key: cluster.key,
        member_count: cluster.memberIds.length,
        earliest_discovery_id: cluster.earliestId,
        members: cluster.links.map((l) => ({
          discovery_id: l.discoveryId,
          is_earliest_discovered: l.discoveryId === cluster.earliestId,
          link_evidence: { reasons: l.reasons, earliest_basis: cluster.earliestBasis },
        })),
      });
      for (const id of cluster.memberIds.slice(1)) {
        const d = byId.get(id);
        if (!d) continue;
        await storeFinding(
          id,
          {
            original_url: d.original_url,
            page_excerpt: null,
            snippet: d.snippet,
            content_fingerprint: d.content_fingerprint,
            discovery_method: d.discovery_method as DiscoveryMethod,
            retrieved_at: d.retrieved_at,
          },
          {
            stageKey: "propagation",
            category: "Related copy / repost",
            severity: 3,
            reason: `Related to earliest discovered source ${hostOf(byId.get(cluster.earliestId)?.original_url ?? "")} (${(cluster.links.find((l) => l.discoveryId === id)?.reasons ?? []).join(", ")})`,
          },
          "CLASSIFIED",
          { captureKind: "cluster_link" },
        );
      }
    }
    await store.upsertCapability({
      analysis_key: "propagation",
      status: "ran",
      reason:
        "Clustered by identical retrieved content, near-identical titles and shared video references; media hashing not run",
      candidates_considered: discoveriesNow.filter((d) => d.identity_bucket !== "UNRELATED").length,
    });
    await emit({
      type: "STAGE_COMPLETED",
      stage: "propagation",
      level: "success",
      message: `Propagation · ${clusters.length} cluster${clusters.length === 1 ? "" : "s"} mapped`,
      detail: { unit: "stage|propagation" },
    });
    done.add("stage|propagation");
    unitsRun++;
  }

  /* ── Coverage + scores + completion ────────────────────────────────────── */
  if (!done.has("finalize")) {
    if (!timeLeft()) return { done: false, unitsRun };
    const sources = await store.listSources();
    const coverage = computeCoverage(sources);
    await store.updateScan({
      families_intended: coverage.intended,
      families_queried_ok: coverage.queriedOk,
      families_failed: coverage.failed,
      families_unavailable: coverage.unavailable,
      families_policy_disabled: coverage.policyDisabled,
      coverage_state: coverage.state,
      stage: "summary",
    });
    await emit({
      type: "COVERAGE_COMPUTED",
      level: coverage.state === "COMPLETE" ? "success" : "warning",
      message: `Coverage: ${coverage.state} — ${coverage.label}`,
      detail: { ...coverage },
    });
    const [discoveriesFinal, findingsFinal, capabilities] = await Promise.all([
      store.listDiscoveries(),
      store.listFindings(),
      store.listCapabilities(),
    ]);
    const riskInputs = riskInputsFromRows({
      discoveries: discoveriesFinal,
      findings: findingsFinal,
      observations,
      clusters,
    });
    const preliminary = computePreliminaryExposure(riskInputs, coverage.state);
    const verified = computeVerifiedRisk(riskInputs, coverage.state);
    await store.insertRiskScore(preliminary);
    await store.insertRiskScore(verified);
    const analysis = analyseScan({
      sources,
      discoveries: discoveriesFinal,
      findings: findingsFinal,
      capabilities,
    });
    await emit({
      type: "SCORES_COMPUTED",
      level: "info",
      message: `Preliminary exposure signal: ${preliminary.band} · Verified assessment: ${verified.band}`,
      detail: { preliminary: preliminary.band, verified: verified.band, counts: analysis.counts },
    });
    const anyProviderError = sources.some((s) => s.state === "provider_error");
    await store.updateScan({
      status: anyProviderError ? "partial" : "completed",
      finished_at: now(),
    });
    await emit({
      type: "SCAN_COMPLETED",
      level: "success",
      message: `Scan complete · ${analysis.counts.relevantItems} relevant item(s) · coverage ${coverage.state}`,
      detail: { unit: "finalize" },
    });
    return {
      done: true,
      unitsRun: unitsRun + 1,
      coverage: coverage.state,
      preliminary: preliminary.band,
      verified: verified.band,
    };
  }
  void findingCount;
  return { done: true, unitsRun };
}

/** Drive a scan to completion in-process (tests / long-lived runtimes). */
export async function runProspectScan(
  ports: RunnerPorts,
  input: RunnerInput,
): Promise<RunnerResult> {
  let last: RunnerResult = { done: false, unitsRun: 0 };
  for (let i = 0; i < 500 && !last.done; i++) {
    last = await runProspectScanStep(ports, input, { budgetMs: 60_000 });
  }
  return last;
}

/** Extract a social profile handle from a profile URL (not a post URL). */
export function profileHandle(url: string): { platform: string; handle: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  const raw = parts[0]!;
  const reserved =
    /^(p|reel|reels|explore|watch|share|status|hashtag|search|login|about|help|video|videos|stories|tv)$/i;
  if (reserved.test(raw)) return null;
  const handle = raw.replace(/^@/, "");
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(handle)) return null;
  if (host === "instagram.com") return { platform: "Instagram", handle };
  if (host === "x.com" || host === "twitter.com") return { platform: "X", handle };
  if (host === "tiktok.com" && raw.startsWith("@")) return { platform: "TikTok", handle };
  if (host === "facebook.com") return { platform: "Facebook", handle };
  if (host === "youtube.com" && raw.startsWith("@")) return { platform: "YouTube", handle };
  return null;
}

/** Safety wrapper: any thrown error marks the scan failed with a visible event. */
export async function runProspectScanStepSafely(
  ports: RunnerPorts,
  input: RunnerInput,
  opts: { budgetMs?: number } = {},
): Promise<RunnerResult> {
  try {
    return await runProspectScanStep(ports, input, opts);
  } catch (error) {
    const message = errorMessage(error);
    try {
      await ports.store.updateScan({
        status: "failed",
        error_message: message,
        finished_at: new Date().toISOString(),
      });
      await ports.store.appendEvent({
        type: "SCAN_FAILED",
        level: "error",
        message: `Scan failed: ${message}`,
      });
    } catch {
      // store unavailable — nothing more we can persist
    }
    return { done: true, unitsRun: 0 };
  }
}
