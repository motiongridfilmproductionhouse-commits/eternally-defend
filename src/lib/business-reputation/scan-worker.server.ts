/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { firecrawlFetch } from "@/lib/firecrawl-client.server";
import { classifyBusinessFinding } from "./classification";
import { buildBusinessQueryPlan } from "./query-plan";
import { scoreBusinessRelevance } from "./relevance";
import { dedupeBusinessResults, normalizeBusinessUrl } from "./url-normalization";
import { combineBusinessProviderResults, type ProviderOutcome } from "./providers";
import { dispatchBusinessReputationScan } from "./scan-worker-dispatch.server";
import {
  BUSINESS_WORKER_BUDGET_MS,
  createBusinessCheckpoint,
  parseBusinessCheckpoint,
  shouldYieldBusinessWorker,
  transferBusinessLease,
  type BusinessScanCheckpoint,
} from "./continuation.server";
import { resolveBusinessInfrastructure } from "./infrastructure.server";
import { buildBusinessReportingIntelligence } from "./reporting-intelligence";
import {
  businessFindingKey,
  recordBusinessFindingHistory,
  recordRemovedBusinessFindings,
} from "./historical.server";
import {
  loadBusinessBaseline,
  markBusinessRemoved,
  persistBusinessFinding,
} from "./storage.server";

const LEASE_MS = 90_000;
const NEGATIVE =
  /fraud|scam|lawsuit|complaint|alleged| ಆರೋಪ|boycott|abuse|harassment|controversy|investigation|recall|fine|arrest|defamation|leak|fake/i;

type WorkerInput = {
  supabase: any;
  scanId: string;
  scanRunToken?: string;
  workerExecutionId: string;
  requestId?: string | null;
};
type DiscoveryItem = {
  url: string;
  title?: string;
  description?: string;
  provider?: string;
  [key: string]: unknown;
};
type WorkerOptions = {
  discover?: (
    query: string,
  ) => Promise<ReturnType<typeof combineBusinessProviderResults<DiscoveryItem>>>;
  budgetMs?: number;
};

async function event(
  input: WorkerInput,
  eventName: string,
  metadata: Record<string, unknown> = {},
  errorMessage?: string,
) {
  const { data: scan } = await input.supabase
    .from("scans")
    .select("user_id")
    .eq("id", input.scanId)
    .maybeSingle();
  await input.supabase.from("business_reputation_worker_events").insert({
    scan_id: input.scanId,
    user_id: scan?.user_id,
    worker_execution_id: input.workerExecutionId,
    request_id: input.requestId ?? null,
    event_name: eventName,
    metadata,
    error_message: errorMessage ?? null,
  });
}

async function touch(input: WorkerInput, patch: Record<string, unknown>) {
  const { data, error } = await input.supabase
    .from("scans")
    .update({
      heartbeat_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
      ...patch,
    })
    .eq("id", input.scanId)
    .eq("scan_type", "business_reputation")
    .eq("status", "running")
    .eq("scan_run_token", input.scanRunToken ?? "")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Business Reputation worker lost scan lease");
}

function score(title: string, description: string) {
  const text = `${title} ${description}`;
  const negative = NEGATIVE.test(text);
  return {
    severity: negative ? "High" : "Low",
    risk: negative ? 78 : 18,
    sentiment: negative ? "Negative" : "Neutral",
    category: negative ? "Controversies" : "General",
  };
}

async function persistFinding(input: WorkerInput, plan: any, item: any, source: string) {
  const title = String(item.title || item.metadata?.title || "Untitled result").slice(0, 500);
  const url = normalizeBusinessUrl(
    String(item.url || item.link || item.metadata?.url || "").trim(),
  );
  if (!url) return false;
  const description = String(
    item.description || item.snippet || item.metadata?.description || "",
  ).slice(0, 2000);
  const relevance = scoreBusinessRelevance({
    title,
    description,
    url,
    businessName: plan.profile.resolvedBrandName,
    aliases: plan.profile.aliases,
    domain: plan.profile.website ? new URL(plan.profile.website).hostname : null,
    city: plan.profile.city,
    industry: plan.profile.businessTypes?.[0],
  });
  if (relevance.band === "rejected") return false;
  const classified = classifyBusinessFinding({ title, description, source });
  const infrastructure = await resolveBusinessInfrastructure(url).catch(() => null);
  const reporting = buildBusinessReportingIntelligence({
    source,
    category: classified.category,
    url,
    infrastructure,
  });
  const published = item.publishedAt || item.published_at || null;
  const identityColumn = item.id || item.videoId ? "external_id" : "canonical_url";
  const identityValue = item.id || item.videoId || url;
  const { data: existing } = await input.supabase
    .from("scan_hits")
    .select("id,scan_id,first_seen_at,times_detected,canonical_url,severity,engagement")
    .eq("user_id", plan.user_id)
    .eq("source", source)
    .eq(identityColumn, identityValue)
    .maybeSingle();
  const checkedAt = new Date().toISOString();
  const row = {
    scan_id: input.scanId,
    user_id: plan.user_id,
    source,
    source_type: source.toLowerCase(),
    external_id: item.id || item.videoId || null,
    canonical_url: url,
    permalink: url,
    title,
    description,
    author: item.author || item.channelTitle || null,
    thumbnail_url: item.thumbnail || item.thumbnail_url || null,
    published_at: published,
    engagement: item.engagement || null,
    threat_score: relevance.score,
    risk_score: relevance.score,
    severity: classified.reviewRequired ? "High" : "Low",
    risk_type: classified.category,
    tags: [classified.category, source],
    metrics: {
      relevance_score: relevance.score,
      relevance_band: relevance.band,
      provider: item.provider || source,
      review_required: classified.reviewRequired,
      reporting,
    },
    source_metadata: { business_profile: plan.profile, infrastructure },
    first_seen_at: existing?.first_seen_at || checkedAt,
    last_seen_at: checkedAt,
    previous_scan_seen: Boolean(existing),
    is_new_since_last_scan: !existing,
    times_detected: (existing?.times_detected || 0) + 1,
  };
  const { error } = await input.supabase.from("scan_hits").upsert(row, {
    onConflict: row.external_id ? "user_id,source,external_id" : "user_id,source,canonical_url",
  });
  if (error) throw new Error(error.message);
  let dedicated = null;
  if (plan.business_profile_id) {
    dedicated = await persistBusinessFinding({
      supabase: input.supabase,
      scanId: input.scanId,
      userId: plan.user_id,
      businessProfileId: plan.business_profile_id,
      row,
      infrastructure,
      reporting,
    });
  }
  const key = businessFindingKey({ source, externalId: row.external_id, url });
  await recordBusinessFindingHistory({
    supabase: input.supabase,
    scanId: input.scanId,
    userId: plan.user_id,
    key,
    existing,
    current: { url, severity: row.severity, engagement: row.engagement },
  });
  await input.supabase
    .from("business_reputation_finding_snapshots")
    .upsert(
      { scan_id: input.scanId, user_id: plan.user_id, finding_key: key, snapshot: row },
      { onConflict: "scan_id,finding_key" },
    );
  return Boolean(dedicated || row);
}

async function firecrawlSearch(query: string): Promise<any[]> {
  const response = await firecrawlFetch("/search", {
    query,
    limit: 8,
    tbs: "qdr:y",
    sources: ["web", "news"],
  });
  if (!response.ok) throw new Error(`Firecrawl returned ${response.status}`);
  const body = await response.json();
  return [...(body.data || []), ...(body.web || []), ...(body.news || [])];
}

async function youtubeSearch(query: string): Promise<any[]> {
  const key = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return [];
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`,
  );
  if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
  const body = await response.json();
  return (body.items || []).map((item: any) => ({
    id: item.id?.videoId,
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    title: item.snippet?.title,
    description: item.snippet?.description,
    author: item.snippet?.channelTitle,
    thumbnail: item.snippet?.thumbnails?.high?.url,
    publishedAt: item.snippet?.publishedAt,
    provider: "YouTube",
  }));
}

async function defaultDiscover(query: string) {
  const [web, youtube] = await Promise.allSettled([firecrawlSearch(query), youtubeSearch(query)]);
  const outcomes: ProviderOutcome<DiscoveryItem>[] = [
    web.status === "fulfilled"
      ? {
          provider: "Firecrawl",
          status: "fulfilled",
          results: web.value.map((x) => ({ ...x, provider: "Firecrawl" })),
        }
      : { provider: "Firecrawl", status: "rejected", results: [], error: "provider unavailable" },
    youtube.status === "fulfilled"
      ? { provider: "YouTube", status: "fulfilled", results: youtube.value }
      : { provider: "YouTube", status: "rejected", results: [], error: "provider unavailable" },
  ];
  return combineBusinessProviderResults(outcomes);
}

export async function executeBusinessReputationScan(
  input: WorkerInput,
  options: WorkerOptions = {},
) {
  await event(input, "worker_execution_started");
  const { data: scan, error } = await input.supabase
    .from("scans")
    .select("*")
    .eq("id", input.scanId)
    .eq("scan_type", "business_reputation")
    .maybeSingle();
  if (error || !scan) throw new Error(error?.message || "Business Reputation scan not found");
  if (scan.status !== "running") return { status: scan.status, findings: 0 };
  if (!scan.scan_run_token) throw new Error("Business Reputation scan lease is missing");
  if (input.scanRunToken && input.scanRunToken !== scan.scan_run_token)
    throw new Error("Business Reputation scan lease does not match");
  if (!input.scanRunToken) throw new Error("Business Reputation scan lease is required");
  const plan = {
    ...(scan.query_plan || {}),
    user_id: scan.user_id,
    profile: scan.brand_profile,
    business_profile_id: scan.business_profile_id,
  };
  const generatedQueries = buildBusinessQueryPlan({
    profile: {
      ...plan.profile,
      resolved: true,
      resolvedBrandName: plan.subject,
      aliases: plan.aliases || [],
      website: plan.profile.website || plan.site || null,
      scope: plan.profile.scope || "brand",
      businessTypes: plan.profile.businessTypes || [],
    },
    handles: plan.handles,
    maxQueries: 8,
  }).map((item) => item.query);
  const checkpoint =
    parseBusinessCheckpoint(scan.scan_checkpoint) || createBusinessCheckpoint(generatedQueries);
  if (!parseBusinessCheckpoint(scan.scan_checkpoint)) {
    try {
      const { data: previous } = await input.supabase
        .from("scans")
        .select("id")
        .eq("user_id", scan.user_id)
        .eq("scan_type", "business_reputation")
        .in("status", ["completed", "completed_with_warnings"])
        .neq("id", input.scanId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (previous?.id) {
        const { data: priorHits } = scan.business_profile_id
          ? {
              data: await loadBusinessBaseline({
                supabase: input.supabase,
                userId: scan.user_id,
                profileId: scan.business_profile_id,
                scanId: input.scanId,
              }),
            }
          : await input.supabase
              .from("scan_hits")
              .select("scan_id,source,external_id,canonical_url,severity,engagement")
              .eq("scan_id", previous.id)
              .eq("user_id", scan.user_id);
        checkpoint.discovery_state.baseline = (priorHits || []).map((row: any) => ({
          ...row,
          finding_key: businessFindingKey({
            source: row.source,
            externalId: row.external_id,
            url: row.canonical_url,
          }),
        }));
      }
    } catch {
      /* baseline comparison is best effort */
    }
  }
  const baseline = Array.isArray(checkpoint.discovery_state.baseline)
    ? (checkpoint.discovery_state.baseline as any[])
    : [];
  const seenKeys = new Set<string>(
    Array.isArray(checkpoint.discovery_state.seen_keys)
      ? (checkpoint.discovery_state.seen_keys as string[])
      : [],
  );
  const startedAtMs = Date.now();
  const budgetMs = options.budgetMs ?? BUSINESS_WORKER_BUDGET_MS;
  const queries = checkpoint.queries;
  let findings = checkpoint.findings_count;
  const providerWarnings: string[] = [...checkpoint.provider_warnings];
  let successfulDiscoveryBatch = checkpoint.next_query_index > 0;
  let didYield = false;
  await touch(input, {
    discovery_metrics: {
      phase: "discovery",
      percent: 10,
      queries_generated: queries.length,
      queries_executed: 0,
      findings: 0,
      scan_checkpoint: checkpoint,
      report_summary: {
        findings,
        queries_completed: checkpoint.next_query_index,
        queries_total: queries.length,
      },
    },
  });
  for (let index = checkpoint.next_query_index; index < queries.length; index += 1) {
    if (shouldYieldBusinessWorker({ startedAtMs, budgetMs })) {
      didYield = true;
      break;
    }
    let siteFilter = "";
    if (plan.site) {
      try {
        siteFilter = `site:${new URL(plan.site).hostname}`;
      } catch {
        siteFilter = "";
      }
    }
    const query = `${queries[index]} ${siteFilter}`.trim();
    const discovered = options.discover
      ? await options.discover(query)
      : await defaultDiscover(query);
    const results = dedupeBusinessResults(discovered.results);
    providerWarnings.push(...discovered.warnings);
    checkpoint.provider_warnings = [
      ...new Set([...checkpoint.provider_warnings, ...discovered.warnings]),
    ];
    if (discovered.status !== "failed") successfulDiscoveryBatch = true;
    for (const item of results) {
      const source = item.provider === "YouTube" ? "YouTube" : "News";
      if (await persistFinding(input, plan, item, source)) findings += 1;
      const normalized = normalizeBusinessUrl(String(item.url || item.link || ""));
      if (normalized)
        seenKeys.add(
          businessFindingKey({
            source,
            externalId:
              item.id != null
                ? String(item.id)
                : item.videoId != null
                  ? String(item.videoId)
                  : null,
            url: normalized,
          }),
        );
    }
    checkpoint.next_query_index = index + 1;
    checkpoint.completed_query_indexes = [
      ...new Set([...checkpoint.completed_query_indexes, index]),
    ];
    checkpoint.pending_query_queue = queries.slice(index + 1);
    checkpoint.findings_count = findings;
    checkpoint.last_batch_at = new Date().toISOString();
    checkpoint.discovery_state = {
      ...checkpoint.discovery_state,
      last_query: query,
      last_provider_status: discovered.status,
      seen_keys: [...seenKeys],
    };
    await touch(input, {
      discovery_metrics: {
        phase: "discovery",
        percent: Math.round(10 + ((index + 1) / queries.length) * 80),
        queries_generated: queries.length,
        queries_executed: index + 1,
        findings,
        provider_status: discovered.status,
        warnings: discovered.warnings,
        scan_checkpoint: checkpoint,
        report_summary: {
          findings,
          queries_completed: checkpoint.next_query_index,
          queries_total: queries.length,
          updated_at: checkpoint.last_batch_at,
        },
      },
    });
    await event(input, "query_completed", {
      query_index: index,
      results: results.length,
      findings,
    });
  }
  if (didYield || checkpoint.next_query_index < queries.length) {
    const transferred = await transferBusinessLease({
      supabase: input.supabase,
      scanId: input.scanId,
      currentToken: input.scanRunToken,
      checkpoint,
    });
    const dispatch = await dispatchBusinessReputationScan({
      scanId: input.scanId,
      scanRunToken: transferred.nextToken,
      startupCorrelationId: randomUUID(),
    });
    await event(input, "continuation_dispatched", {
      next_worker_execution_id: dispatch.executionId,
      next_query_index: checkpoint.next_query_index,
      remaining_queries: checkpoint.pending_query_queue.length,
      dispatched: dispatch.dispatched,
    });
    if (!dispatch.dispatched) {
      await input.supabase
        .from("scans")
        .update({
          status: "failed",
          error: "Business Reputation continuation could not be started.",
          scan_run_token: null,
          lease_expires_at: null,
        })
        .eq("id", input.scanId)
        .eq("status", "running")
        .eq("scan_run_token", transferred.nextToken);
      return { status: "failed", findings, pending_work: true, dispatched_next: false };
    }
    return {
      status: "running",
      findings,
      pending_work: true,
      dispatched_next: true,
      next_query_index: checkpoint.next_query_index,
    };
  }
  const terminalStatus = successfulDiscoveryBatch
    ? providerWarnings.length
      ? "completed_with_warnings"
      : "completed"
    : "failed";
  const removedFindings = await recordRemovedBusinessFindings({
    supabase: input.supabase,
    scanId: input.scanId,
    userId: scan.user_id,
    baseline,
    seenKeys,
  });
  const dedicatedRemoved = scan.business_profile_id
    ? await markBusinessRemoved({
        supabase: input.supabase,
        scanId: input.scanId,
        userId: scan.user_id,
        profileId: scan.business_profile_id,
        seenKeys,
      })
    : 0;
  await touch(input, {
    status: terminalStatus,
    error:
      terminalStatus === "failed"
        ? "Business Reputation discovery is temporarily unavailable. Please try again."
        : null,
    completed_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    lease_expires_at: null,
    scan_run_token: null,
    total_hits: findings,
    unique_hits: findings,
    new_hits: findings,
    report_summary: {
      findings,
      sources: ["News", "YouTube"],
      generated_at: new Date().toISOString(),
    },
    discovery_metrics: {
      phase: terminalStatus,
      percent: 100,
      queries_generated: queries.length,
      queries_executed: queries.length,
      findings,
      warnings: providerWarnings,
      removed_findings: Math.max(removedFindings, dedicatedRemoved),
    },
  });
  await event(
    input,
    terminalStatus === "failed" ? "worker_execution_failed" : "worker_execution_completed",
    { findings, warnings: providerWarnings },
  );
  return { status: terminalStatus, findings };
}
