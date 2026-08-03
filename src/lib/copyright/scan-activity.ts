/**
 * Bounded, sanitized per-site investigation telemetry for Copyright Intelligence.
 * Stored in the existing copyright_scans.stats JSON — no migration required.
 */

import { sanitizeEvidenceUrl } from "@/lib/deepfake/evidence-url";
import { isActionablePiracy } from "./taxonomy";
import { hostOf } from "./url.server";
import { publicCapabilityLabel } from "./public-surface";
import { isNeverDisplayHost } from "./verified-distribution";

/** Maximum persisted investigation events (newest retained). */
export const SCAN_ACTIVITY_MAX_EVENTS = 25;

export const COPYRIGHT_WORKFLOW_STAGES = [
  { key: "preparing_reference", label: "Preparing reference material" },
  { key: "analyzing_visual", label: "Analyzing visual content" },
  { key: "extracting_identifiers", label: "Extracting title identifiers" },
  { key: "discovering_candidates", label: "Discovering online candidates" },
  { key: "retrieving_pages", label: "Retrieving exact pages" },
  { key: "checking_access", label: "Checking distribution access" },
  { key: "classifying_evidence", label: "Classifying evidence" },
  { key: "saving_report", label: "Saving report" },
] as const;

export type CopyrightWorkflowStageKey =
  (typeof COPYRIGHT_WORKFLOW_STAGES)[number]["key"];

export type ScanActivityProvider =
  | "known_url"
  | "firecrawl"
  | "brightdata"
  | "serpapi"
  | "telegram";

export type ScanActivityStage =
  | "discovered"
  | "resolving"
  | "url_safety"
  | "retrieving"
  | "rendering"
  | "matching_title"
  | "access_evidence"
  | "detail_follow"
  | "classifying"
  | "saved_finding"
  | "rejected"
  | "retrieval_failed"
  | "blocked_safety"
  | "excluded_official";

export type ScanActivityThreat =
  | "checking"
  | "no_threat"
  | "potential"
  | "high_risk"
  | "verified_finding"
  | "retrieval_failed"
  | "blocked_safety"
  | "excluded";

export interface ScanActivityEvent {
  id: string;
  hostname: string;
  page_label: string;
  provider: ScanActivityProvider;
  stage: ScanActivityStage;
  stage_label: string;
  threat: ScanActivityThreat;
  threat_label: string;
  classification?: string | null;
  evidence_href?: string | null;
  occurred_at: string;
}

const STAGE_LABELS: Record<ScanActivityStage, string> = {
  discovered: "Discovered",
  resolving: "Resolving website",
  url_safety: "Checking URL safety",
  retrieving: "Retrieving exact page",
  rendering: "Rendering dynamic content",
  matching_title: "Matching protected title",
  access_evidence: "Looking for player/download access",
  detail_follow: "Following title detail page",
  classifying: "Classifying distribution evidence",
  saved_finding: "Saved as verified finding",
  rejected: "Rejected",
  retrieval_failed: "Retrieval failed",
  blocked_safety: "Blocked for safety",
  excluded_official: "Official/catalog/promo",
};

const THREAT_LABELS: Record<ScanActivityThreat, string> = {
  checking: "CHECKING",
  no_threat: "NO THREAT EVIDENCE",
  potential: "POTENTIAL THREAT",
  high_risk: "HIGH-RISK EVIDENCE",
  verified_finding: "VERIFIED DISTRIBUTION FINDING",
  retrieval_failed: "RETRIEVAL FAILED",
  blocked_safety: "BLOCKED FOR SAFETY",
  excluded: "OFFICIAL/CATALOG/PROMO",
};

const EXCLUDED_CLASSIFICATIONS = new Set([
  "CINEMA_OR_SHOWTIME",
  "TRAILER_OR_PROMO",
  "REVIEW_OR_NEWS",
  "CAST_OR_INFORMATION",
  "SOCIAL_DISCUSSION",
  "OFFICIAL_OR_AUTHORIZED",
  "OFFICIAL_OR_AUTHORIZED_PAGE",
  "CATALOG_OR_LISTING",
  "TRAILER_OR_PROMOTIONAL",
]);

export function scanActivityStageLabel(stage: ScanActivityStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function scanActivityThreatLabel(threat: ScanActivityThreat): string {
  return THREAT_LABELS[threat] ?? threat;
}

export function sanitizeActivityHostname(
  value: string | null | undefined,
): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname.replace(/^www\./, "").toLowerCase();
    }
  } catch {
    /* fall through */
  }
  const host = trimmed
    .replace(/^www\./, "")
    .split("/")[0]
    ?.split("?")[0]
    ?.split("#")[0];
  if (!host || /[^a-z0-9.-]/.test(host)) return null;
  return host;
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export function sanitizeActivityPageLabel(
  value: string | null | undefined,
  fallbackPath?: string | null,
): string {
  const scrubSecrets = (text: string) =>
    text
      .replace(/\bBearer\s+\S+/gi, "[redacted]")
      .replace(/\b(?:fc|lovc|sk|api)[-_][A-Za-z0-9]{8,}\b/gi, "[redacted]")
      .replace(/\b[A-Za-z0-9_-]{20,}\b/g, (m) =>
        /^(?:fc|lovc|sk)/i.test(m) ? "[redacted]" : m,
      );

  if (typeof value === "string" && value.trim()) {
    const cleaned = scrubSecrets(value.replace(/[\r\n\t]+/g, " ").trim()).slice(0, 120);
    if (cleaned) return cleaned;
  }
  const path = fallbackPath ? pathnameOf(fallbackPath) : null;
  if (path && path !== "/") return path.slice(0, 80);
  return "/";
}

export function resolveActivityProvider(
  leadQuery: string | null | undefined,
): ScanActivityProvider {
  const q = (leadQuery ?? "").toLowerCase();
  if (q === "known_url_seed" || q.startsWith("known_url")) return "known_url";
  if (q.startsWith("brightdata:") || q.includes("brightdata")) return "brightdata";
  if (q.startsWith("serpapi:") || q.includes("serpapi")) return "serpapi";
  if (/\btelegram\b/i.test(q)) return "telegram";
  return "firecrawl";
}

export function providerDisplayLabel(provider: ScanActivityProvider | string): string {
  return publicCapabilityLabel(provider);
}

export function workflowStageIndex(
  key: CopyrightWorkflowStageKey | null | undefined,
): number {
  if (!key) return 0;
  const idx = COPYRIGHT_WORKFLOW_STAGES.findIndex((s) => s.key === key);
  return idx >= 0 ? idx : 0;
}

export function resolveWorkflowStageFromStats(
  stats: Record<string, unknown> | null | undefined,
): CopyrightWorkflowStageKey {
  const raw = stats?.activity_workflow_stage;
  if (typeof raw === "string") {
    const idx = COPYRIGHT_WORKFLOW_STAGES.findIndex((s) => s.key === raw);
    if (idx >= 0) return COPYRIGHT_WORKFLOW_STAGES[idx]!.key;
  }
  if (stats?.finished_at) return "saving_report";
  if (stats?.classification_started) return "classifying_evidence";
  if (stats?.first_page_crawled) return "checking_access";
  if (stats?.discovery_started) return "discovering_candidates";
  if (stats?.queries_generated) return "extracting_identifiers";
  if (stats?.executor_started || stats?.executor_started_at) return "analyzing_visual";
  return "preparing_reference";
}

function activityDedupeKey(url: string, stage: ScanActivityStage): string {
  return `${url}::${stage}`;
}

function stableActivityId(url: string, stage: ScanActivityStage): string {
  return activityDedupeKey(url, stage);
}

export function classifyDistributionThreat(input: {
  crawlFailed?: boolean;
  classification?: string | null;
  clientVisible?: boolean;
  strongEvidence?: boolean;
  identityEvidence?: string[];
  blocked?: boolean;
}): { stage: ScanActivityStage; threat: ScanActivityThreat } {
  if (input.blocked) {
    return { stage: "blocked_safety", threat: "blocked_safety" };
  }
  if (input.crawlFailed) {
    return { stage: "retrieval_failed", threat: "retrieval_failed" };
  }
  const cls = input.classification ?? "";
  if (EXCLUDED_CLASSIFICATIONS.has(cls)) {
    return { stage: "excluded_official", threat: "excluded" };
  }
  if (
    input.clientVisible &&
    input.strongEvidence &&
    isActionablePiracy(cls)
  ) {
    return { stage: "saved_finding", threat: "verified_finding" };
  }
  if (input.strongEvidence && !input.clientVisible) {
    return { stage: "classifying", threat: "high_risk" };
  }
  if (input.identityEvidence?.length) {
    return { stage: "access_evidence", threat: "potential" };
  }
  return { stage: "rejected", threat: "no_threat" };
}

export function parseRecentActivity(
  stats: Record<string, unknown> | null | undefined,
): ScanActivityEvent[] {
  const raw = stats?.recent_activity;
  if (!Array.isArray(raw)) return [];
  const out: ScanActivityEvent[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const hostname = typeof r.hostname === "string" ? r.hostname : null;
    const stage = typeof r.stage === "string" ? (r.stage as ScanActivityStage) : null;
    const threat = typeof r.threat === "string" ? (r.threat as ScanActivityThreat) : null;
    const provider = typeof r.provider === "string" ? (r.provider as ScanActivityProvider) : null;
    const occurredAt = typeof r.occurred_at === "string" ? r.occurred_at : null;
    if (!id || !hostname || !stage || !threat || !provider || !occurredAt) continue;
    const safeHost = sanitizeActivityHostname(hostname) ?? hostname;
    const safeLabel = sanitizeActivityPageLabel(
      typeof r.page_label === "string" ? r.page_label : null,
    );
    out.push({
      id,
      hostname: safeHost,
      page_label: safeLabel,
      provider,
      stage,
      stage_label:
        typeof r.stage_label === "string"
          ? r.stage_label
          : scanActivityStageLabel(stage),
      threat,
      threat_label:
        typeof r.threat_label === "string"
          ? r.threat_label
          : scanActivityThreatLabel(threat),
      classification:
        typeof r.classification === "string" ? r.classification : null,
      evidence_href:
        typeof r.evidence_href === "string"
          ? sanitizeEvidenceUrl(r.evidence_href)
          : null,
      occurred_at: occurredAt,
    });
  }
  return out;
}

/** Website investigation stream — prefers dedicated website_activity, falls back to recent_activity. */
export function parseWebsiteActivity(
  stats: Record<string, unknown> | null | undefined,
): ScanActivityEvent[] {
  const dedicated = stats?.website_activity;
  if (Array.isArray(dedicated) && dedicated.length > 0) {
    return parseRecentActivity({ recent_activity: dedicated });
  }
  return parseRecentActivity(stats);
}

/** Newest-first ordering for UI. */
export function sortActivityNewestFirst(
  events: ScanActivityEvent[],
): ScanActivityEvent[] {
  return [...events].sort(
    (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at),
  );
}

export type ScanActivityCounters = {
  queries_completed: number;
  candidate_pages: number;
  websites_checked: number;
  potential_threats: number;
  verified_findings: number;
  provider_failures: number;
};

export function activityCountersFromStats(
  stats: Record<string, unknown> | null | undefined,
): ScanActivityCounters {
  const n = (key: string) => {
    const v = stats?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const events = parseRecentActivity(stats);
  const potentialFromEvents = events.filter(
    (e) => e.threat === "potential" || e.threat === "high_risk",
  ).length;
  const verifiedFromEvents = events.filter(
    (e) => e.threat === "verified_finding",
  ).length;
  return {
    // Query progress can come from the crawl phase (`queries_executed`) or,
    // earlier in the run, from live search-sweep telemetry.
    queries_completed: Math.max(
      n("queries_executed"),
      n("brightdata_queries_completed"),
      n("firecrawl_queries_completed"),
    ),
    candidate_pages: Math.max(
      n("unique_candidate_pages"),
      n("provider_results"),
      n("candidates"),
      n("leads"),
      n("brightdata_unique_urls"),
      n("brightdata_candidates"),
    ),
    websites_checked:
      Math.max(
        n("websites_checked"),
        n("pages_crawled"),
      ),
    potential_threats:
      n("potential_threats") ||
      potentialFromEvents ||
      n("access_evidence_pages"),
    verified_findings:
      n("client_visible_findings") ||
      n("verified_findings") ||
      verifiedFromEvents,
    provider_failures: Math.max(
      n("provider_failures"),
      n("brightdata_failures"),
    ),
  };

}

export type BrightDataProviderStatus =
  | "not_configured"
  | "pending"
  | "idle"
  | "running"
  | "completed"
  | "error";


export type BrightDataTelemetry = {
  configured: boolean;
  running: boolean;
  status: BrightDataProviderStatus;
  statusLabel: string;
  requests: number;
  successes: number;
  failures: number;
  candidates: number;
  uniqueUrls: number;
  queriesGenerated: number;
  queriesCompleted: number;
  durationMs: number;
  lastQuery: string | null;
  errors: string[];
  endpoint: string | null;
  zone: string | null;
  apiKeyPresent: boolean;
};

const BRIGHTDATA_ERROR_LABELS: Record<string, string> = {
  missing_api_key: "Missing API key",
  invalid_credentials: "Invalid credentials",
  insufficient_credits: "Insufficient credits",
  rate_limited: "Rate limited",
  timeout: "Timeout",
  provider_unavailable: "Provider unavailable",
  invalid_response: "Invalid response",
  no_results: "No results",
  http_error: "Provider HTTP error",
  network_error: "Network error",
};

export function brightDataErrorLabel(category: string): string {
  return BRIGHTDATA_ERROR_LABELS[category] ?? category.replace(/_/g, " ");
}

/** Bright Data provider telemetry derived from live scan stats (no secrets). */
export function brightDataTelemetryFromStats(
  stats: Record<string, unknown> | null | undefined,
  scanStatus?: string | null,
): BrightDataTelemetry {
  const num = (key: string) => {
    const v = stats?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const diag = (stats?.["brightdata_diagnostic"] ?? null) as Record<string, unknown> | null;
  const configuredRaw = stats?.["brightdata_configured"];
  const diagConfigured = diag?.["configured"];
  const configured =
    configuredRaw === true || (typeof diagConfigured === "boolean" && diagConfigured === true);
  // Before the first Bright Data activity push there is no provider state yet —
  // that is "pending", not "missing API key".
  const unknownConfig =
    typeof configuredRaw !== "boolean" && typeof diagConfigured !== "boolean";
  const scanRunning = scanStatus === "running" || scanStatus === "queued" || scanStatus === "pending";
  const running = stats?.["brightdata_running"] === true && scanRunning;

  const byCategory = (stats?.["brightdata_failures_by_category"] ?? null) as
    | Record<string, unknown>
    | null;
  const errors: string[] = [];
  if (byCategory) {
    for (const [category, count] of Object.entries(byCategory)) {
      if (typeof count === "number" && count > 0) {
        errors.push(`${brightDataErrorLabel(category)} (${count})`);
      }
    }
  }
  if (!configured && !unknownConfig && !errors.length) {
    errors.push(brightDataErrorLabel("missing_api_key"));
  }

  const requests = num("brightdata_requests");
  const failures = num("brightdata_failures");
  const durationMs = num("brightdata_duration_ms") || num("brightdata_elapsed_ms");

  let status: BrightDataProviderStatus;
  if (unknownConfig) status = "pending";
  else if (!configured) status = "not_configured";
  else if (running) status = "running";
  else if (failures > 0 && num("brightdata_successes") === 0 && requests > 0) status = "error";
  else if (requests > 0 || durationMs > 0) status = "completed";
  else status = "idle";

  const statusLabel =
    status === "not_configured"
      ? "Not configured"
      : status === "pending"
        ? "Pending"
        : status === "running"
          ? "Running"
          : status === "error"
            ? "Error"
            : status === "completed"
              ? "Completed"
              : "Idle";

  const lastQueryRaw = stats?.["brightdata_last_query"];

  return {
    configured,
    running,
    status,
    statusLabel,
    requests,
    successes: num("brightdata_successes"),
    failures,
    candidates: num("brightdata_candidates"),
    uniqueUrls: num("brightdata_unique_urls") || num("brightdata_candidates"),
    queriesGenerated: num("brightdata_queries_generated"),
    queriesCompleted: num("brightdata_queries_completed"),
    durationMs,
    lastQuery: typeof lastQueryRaw === "string" && lastQueryRaw ? lastQueryRaw.slice(0, 160) : null,
    errors,
    endpoint: typeof diag?.["endpoint"] === "string" ? (diag["endpoint"] as string) : null,
    zone: typeof diag?.["zone"] === "string" ? (diag["zone"] as string) : null,
    apiKeyPresent: diag?.["api_key_present"] === true,
  };
}

export type CopyrightThreatBadgeTone =
  | "scanning"
  | "potential"
  | "multiple"
  | "verified"
  | "provider_limited"
  | "failed"
  | "partial";

export function resolveCopyrightThreatBadge(input: {
  scanStatus?: string | null;
  stats?: Record<string, unknown> | null;
  verifiedFindings?: number;
  potentialFindings?: number;
}): { tone: CopyrightThreatBadgeTone; label: string } {
  const status = input.scanStatus ?? null;
  const stats = input.stats ?? {};
  const verified =
    input.verifiedFindings ??
    (typeof stats.verified_findings === "number"
      ? stats.verified_findings
      : typeof stats.client_visible_findings === "number"
        ? stats.client_visible_findings
        : typeof stats.matches === "number"
          ? stats.matches
          : 0);
  const potential =
    input.potentialFindings ??
    activityCountersFromStats(stats).potential_threats;

  if (status === "failed") {
    const category =
      typeof stats.failure_category === "string"
        ? stats.failure_category
        : typeof stats.failure_reason === "string"
          ? stats.failure_reason.slice(0, 48)
          : "SCAN FAILED";
    return { tone: "failed", label: category.toUpperCase() };
  }
  if (status === "partial") {
    if (verified > 0) {
      return { tone: "verified", label: "VERIFIED DISTRIBUTION EVIDENCE" };
    }
    return { tone: "partial", label: "VERIFIED PROGRESS SAVED" };
  }

  const failuresByCat = stats.provider_failures_by_category;
  const circuitOpen = stats.firecrawl_circuit_opened === true;
  const providerFailures =
    typeof stats.provider_failures === "number" ? stats.provider_failures : 0;
  const providerLimited =
    circuitOpen ||
    (providerFailures > 0 &&
      typeof failuresByCat === "object" &&
      failuresByCat !== null &&
      Object.values(failuresByCat as Record<string, number>).some((v) => v > 0));

  if (verified > 0) {
    return { tone: "verified", label: "VERIFIED DISTRIBUTION EVIDENCE" };
  }
  if (potential >= 2) {
    return { tone: "multiple", label: "MULTIPLE THREATS DETECTED" };
  }
  if (potential === 1) {
    return { tone: "potential", label: "POTENTIAL THREAT DETECTED" };
  }
  if (providerLimited && status === "running") {
    return { tone: "provider_limited", label: "DISCOVERY CHANNEL LIMITED" };
  }
  return { tone: "scanning", label: "SCANNING — NO VERIFIED THREAT YET" };
}

export type SeenActivityThreatState = {
  scanId: string | null;
  ids: Set<string>;
  seeded: boolean;
};

/** One-time pulse for newly persisted verified findings (not on refresh). */
export function resolveNewVerifiedActivityPulse(input: {
  scanId: string | null;
  events: ScanActivityEvent[];
  previous: SeenActivityThreatState | null;
}): {
  pulseIds: string[];
  isInitialSeed: boolean;
  next: SeenActivityThreatState;
} {
  const verifiedIds = input.events
    .filter((e) => e.threat === "verified_finding")
    .map((e) => e.id);
  const scanId = input.scanId;
  const previous = input.previous;

  if (!scanId) {
    return {
      pulseIds: [],
      isInitialSeed: true,
      next: { scanId: null, ids: new Set(), seeded: false },
    };
  }

  if (!previous || previous.scanId !== scanId || !previous.seeded) {
    return {
      pulseIds: [],
      isInitialSeed: true,
      next: { scanId, ids: new Set(verifiedIds), seeded: true },
    };
  }

  const pulseIds = verifiedIds.filter((id) => !previous.ids.has(id));
  const nextIds = new Set(previous.ids);
  for (const id of verifiedIds) nextIds.add(id);
  return {
    pulseIds,
    isInitialSeed: false,
    next: { scanId, ids: nextIds, seeded: true },
  };
}

export function formatRelativeActivityTime(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const delta = Math.max(0, nowMs - ts);
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** In-memory recorder owned by the active scan executor. */
export class ScanActivityRecorder {
  private events: ScanActivityEvent[] = [];
  private dedupe = new Map<string, string>();
  private workflowStage: CopyrightWorkflowStageKey = "preparing_reference";
  private websitesChecked = 0;
  private potentialThreats = 0;
  private verifiedFindings = 0;

  setWorkflowStage(stage: CopyrightWorkflowStageKey): void {
    this.workflowStage = stage;
  }

  getWorkflowStage(): CopyrightWorkflowStageKey {
    return this.workflowStage;
  }

  private upsert(event: ScanActivityEvent): boolean {
    const key = activityDedupeKey(
      event.id.split("::")[0] ?? event.id,
      event.stage,
    );
    const existingId = this.dedupe.get(key);
    if (existingId) {
      const idx = this.events.findIndex((e) => e.id === existingId);
      if (idx >= 0) {
        this.events[idx] = event;
        this.dedupe.set(key, event.id);
        return false;
      }
    }
    this.dedupe.set(key, event.id);
    this.events.unshift(event);
    if (this.events.length > SCAN_ACTIVITY_MAX_EVENTS) {
      const removed = this.events.pop();
      if (removed) {
        for (const [k, id] of this.dedupe.entries()) {
          if (id === removed.id) this.dedupe.delete(k);
        }
      }
    }
    return true;
  }

  private baseEvent(input: {
    url: string;
    pageTitle?: string | null;
    provider: ScanActivityProvider;
    stage: ScanActivityStage;
    threat: ScanActivityThreat;
    classification?: string | null;
    evidenceHref?: string | null;
    at?: Date;
  }): ScanActivityEvent {
    const hostname =
      sanitizeActivityHostname(input.url) ??
      sanitizeActivityHostname(hostOf(input.url) ?? "") ??
      "unknown";
    const stage = input.stage;
    const id = stableActivityId(input.url, stage);
    return {
      id,
      hostname,
      page_label: sanitizeActivityPageLabel(input.pageTitle, input.url),
      provider: input.provider,
      stage,
      stage_label: scanActivityStageLabel(stage),
      threat: input.threat,
      threat_label: scanActivityThreatLabel(input.threat),
      classification: input.classification ?? null,
      evidence_href: input.evidenceHref
        ? sanitizeEvidenceUrl(input.evidenceHref)
        : null,
      occurred_at: (input.at ?? new Date()).toISOString(),
    };
  }

  recordChecking(input: {
    url: string;
    pageTitle?: string | null;
    provider?: ScanActivityProvider;
    stage?: ScanActivityStage;
    leadQuery?: string | null;
  }): void {
    const provider =
      input.provider ?? resolveActivityProvider(input.leadQuery ?? null);
    const event = this.baseEvent({
      url: input.url,
      pageTitle: input.pageTitle,
      provider,
      stage: input.stage ?? "retrieving",
      threat: "checking",
    });
    this.upsert(event);
  }

  recordDiscovered(input: {
    url: string;
    pageTitle?: string | null;
    leadQuery?: string | null;
  }): void {
    const provider = resolveActivityProvider(input.leadQuery ?? null);
    this.upsert(
      this.baseEvent({
        url: input.url,
        pageTitle: input.pageTitle,
        provider,
        stage: "discovered",
        threat: "checking",
      }),
    );
  }

  recordBlocked(input: {
    url: string;
    pageTitle?: string | null;
    reason?: string | null;
  }): void {
    this.upsert(
      this.baseEvent({
        url: input.url,
        pageTitle: input.pageTitle ?? input.reason,
        provider: "known_url",
        stage: "blocked_safety",
        threat: "blocked_safety",
        classification: "INVESTIGATION_LEAD",
      }),
    );
  }

  recordDistributionOutcome(input: {
    url: string;
    pageTitle?: string | null;
    leadQuery?: string | null;
    crawlFailed?: boolean;
    classification?: string | null;
    clientVisible?: boolean;
    strongEvidence?: boolean;
    identityEvidence?: string[];
    rendered?: boolean;
    blocked?: boolean;
  }): void {
    const provider = resolveActivityProvider(input.leadQuery ?? null);
    const { stage, threat } = classifyDistributionThreat({
      crawlFailed: input.crawlFailed,
      classification: input.classification,
      clientVisible: input.clientVisible,
      strongEvidence: input.strongEvidence,
      identityEvidence: input.identityEvidence,
      blocked: input.blocked,
    });
    const evidenceHref =
      threat === "verified_finding" ? sanitizeEvidenceUrl(input.url) : null;
    const isNew = this.upsert(
      this.baseEvent({
        url: input.url,
        pageTitle: input.pageTitle,
        provider,
        stage: input.rendered && stage === "retrieval_failed" ? "rendering" : stage,
        threat,
        classification: input.classification ?? null,
        evidenceHref,
      }),
    );
    if (!isNew) return;
    this.websitesChecked += 1;
    if (threat === "potential" || threat === "high_risk") {
      this.potentialThreats += 1;
    }
    if (threat === "verified_finding") {
      this.verifiedFindings += 1;
    }
  }

  recordProviderNote(input: {
    provider: ScanActivityProvider;
    stage: ScanActivityStage;
    hostname: string;
    pageLabel: string;
    threat?: ScanActivityThreat;
  }): void {
    const id = `${input.provider}::${input.stage}::${input.hostname}`;
    this.upsert({
      id,
      hostname: sanitizeActivityHostname(input.hostname) ?? input.hostname,
      page_label: input.pageLabel.slice(0, 120),
      provider: input.provider,
      stage: input.stage,
      stage_label: scanActivityStageLabel(input.stage),
      threat: input.threat ?? "retrieval_failed",
      threat_label: scanActivityThreatLabel(input.threat ?? "retrieval_failed"),
      occurred_at: new Date().toISOString(),
    });
  }

  mergeToStats(
    stats: Record<string, unknown>,
    extra?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...stats,
      ...(extra ?? {}),
      activity_workflow_stage: this.workflowStage,
      recent_activity: this.events.map((e) => ({
        id: e.id,
        hostname: e.hostname,
        page_label: e.page_label,
        provider: e.provider,
        stage: e.stage,
        stage_label: e.stage_label,
        threat: e.threat,
        threat_label: e.threat_label,
        classification: e.classification ?? null,
        evidence_href: e.evidence_href ?? null,
        occurred_at: e.occurred_at,
      })),
      websites_checked: Math.max(
        this.websitesChecked,
        typeof stats.websites_checked === "number" ? stats.websites_checked : 0,
      ),
      potential_threats: Math.max(
        this.potentialThreats,
        typeof stats.potential_threats === "number" ? stats.potential_threats : 0,
      ),
      verified_findings: Math.max(
        this.verifiedFindings,
        typeof stats.verified_findings === "number" ? stats.verified_findings : 0,
        typeof stats.client_visible_findings === "number"
          ? stats.client_visible_findings
          : 0,
      ),
      last_progress_at: new Date().toISOString(),
      website_activity: this.events.map((e) => ({
        id: e.id,
        hostname: e.hostname,
        page_label: e.page_label,
        provider: e.provider,
        stage: e.stage,
        stage_label: e.stage_label,
        threat: e.threat,
        threat_label: e.threat_label,
        classification: e.classification ?? null,
        evidence_href: e.evidence_href ?? null,
        occurred_at: e.occurred_at,
      })),
    };
  }

  restoreFromStats(stats: Record<string, unknown> | null | undefined): void {
    const existing = parseRecentActivity(stats ?? {});
    this.events = sortActivityNewestFirst(existing).slice(0, SCAN_ACTIVITY_MAX_EVENTS);
    this.dedupe.clear();
    for (const event of this.events) {
      const urlKey = event.id.includes("::")
        ? event.id.split("::")[0]!
        : event.hostname;
      this.dedupe.set(activityDedupeKey(urlKey, event.stage), event.id);
    }
    const wf = stats?.activity_workflow_stage;
    if (typeof wf === "string") {
      const idx = COPYRIGHT_WORKFLOW_STAGES.findIndex((s) => s.key === wf);
      if (idx >= 0) this.workflowStage = COPYRIGHT_WORKFLOW_STAGES[idx]!.key;
    }
    this.websitesChecked =
      typeof stats?.websites_checked === "number" ? stats.websites_checked : 0;
    this.potentialThreats =
      typeof stats?.potential_threats === "number" ? stats.potential_threats : 0;
    this.verifiedFindings =
      typeof stats?.verified_findings === "number" ? stats.verified_findings : 0;
  }
}

export async function flushScanActivity(
  update: (stats: Record<string, unknown>) => Promise<unknown>,
  stats: Record<string, unknown>,
  recorder: ScanActivityRecorder,
  extra?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  try {
    await update(recorder.mergeToStats(stats, extra));
  } catch {
    /* never block the scan */
  }
}

/* ------------------------------------------------------------------ *
 * User-facing activity presentation
 *
 * Only verified illegal distribution findings may reach the dashboard,
 * timeline, radar or map. Searched-only platforms, retrieval failures and
 * official/catalog pages stay in the internal log.
 * ------------------------------------------------------------------ */

/** Clean, operator-facing phrase for a verified activity event. */
export function cleanActivityLabel(event: ScanActivityEvent): string {
  const cls = (event.classification ?? "").toUpperCase();
  if (cls.includes("DOWNLOAD")) return "Unauthorized download page detected";
  if (cls.includes("STREAM")) return "Embedded streaming player verified";
  if (cls.includes("TORRENT")) return "Torrent distribution confirmed";
  if (cls.includes("MIRROR")) return "Mirror domain discovered";
  if (cls.includes("TELEGRAM")) return "Public Telegram distribution verified";
  if (cls.includes("FILE") || cls.includes("HOST")) return "Direct file copy verified";
  if (cls.includes("ARCHIVE")) return "Archived full copy verified";
  return "Unauthorized distribution verified";
}

/**
 * Keep only verified distribution events on hosts that may be displayed.
 * Everything else remains internal telemetry.
 */
export function filterDisplayableActivity(
  events: ScanActivityEvent[],
): ScanActivityEvent[] {
  return events.filter((event) => {
    if (event.threat !== "verified_finding" || event.stage !== "saved_finding") return false;
    if (isNeverDisplayHost(event.hostname)) return false;
    if (event.classification && EXCLUDED_CLASSIFICATIONS.has(event.classification)) return false;
    return true;
  });
}
