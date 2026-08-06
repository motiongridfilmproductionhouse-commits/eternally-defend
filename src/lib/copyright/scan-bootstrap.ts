/**
 * Immediate UI bootstrap for Copyright Intelligence scans — operational only,
 * never fabricated evidence. Canonical persisted telemetry remains in stats JSON.
 */

import { parseWebsiteActivity, type ScanActivityEvent } from "@/lib/copyright/scan-activity";
import { mergeCopyrightPollStats } from "@/lib/copyright/scan-poll-stats";
import {
  mergeSourceActivityIntoStats,
  parseSourceActivity,
  sourceActivityLabel,
  type SourceActivityEntry,
  type SourceActivityStatus,
} from "@/lib/copyright/source-activity";

export type BootstrapProviderStatus = "starting";

export interface ScanBootstrapProvider {
  provider: string;
  label: string;
  status: BootstrapProviderStatus;
}

export interface ScanBootstrapState {
  scan_id: string;
  status: "queued";
  providers: ScanBootstrapProvider[];
  created_at: string;
}

const BOOTSTRAP_PROVIDER_CATALOG: Array<{ provider: string; label: string }> = [
  { provider: "bright_data", label: "Expanded Discovery" },
  { provider: "firecrawl", label: "Public Web" },
  { provider: "youtube", label: "Public Video" },
];

export function bootstrapProvidersForConfigured(
  configuredProviderIds: string[],
): ScanBootstrapProvider[] {
  const allowed = new Set(configuredProviderIds);
  return BOOTSTRAP_PROVIDER_CATALOG.filter((p) => allowed.has(p.provider)).map((p) => ({
    ...p,
    status: "starting" as const,
  }));
}

export function createScanBootstrap(input: {
  scanId: string;
  configuredProviderIds: string[];
  createdAt?: string;
}): ScanBootstrapState {
  return {
    scan_id: input.scanId,
    status: "queued",
    providers: bootstrapProvidersForConfigured(input.configuredProviderIds),
    created_at: input.createdAt ?? new Date().toISOString(),
  };
}

function bootstrapSourceEntries(
  providers: ScanBootstrapProvider[],
  updatedAt: string,
): SourceActivityEntry[] {
  return providers.map((p) => ({
    provider: p.provider,
    label: p.label,
    status: "starting" as SourceActivityStatus,
    requests: 0,
    candidates: 0,
    failures: 0,
    updated_at: updatedAt,
  }));
}

export function bootstrapOperationalWebsiteEvents(scanId: string): ScanActivityEvent[] {
  const at = new Date().toISOString();
  return [
    {
      id: `bootstrap:${scanId}:initializing`,
      hostname: "Eterna investigation",
      page_label: "Preparing reference material and discovery channels",
      provider: "firecrawl",
      stage: "discovered",
      stage_label: "Initializing",
      threat: "checking",
      threat_label: "INITIALIZING",
      occurred_at: at,
    },
  ];
}

export function bootstrapStatsFromState(state: ScanBootstrapState): Record<string, unknown> {
  const website = bootstrapOperationalWebsiteEvents(state.scan_id);
  const base: Record<string, unknown> = {
    scan_bootstrap: true,
    workflow_stage: "preparing_reference",
    last_progress_at: state.created_at,
  };
  const withProviders = mergeSourceActivityIntoStats(
    base,
    bootstrapSourceEntries(state.providers, state.created_at),
  );
  return {
    ...withProviders,
    website_activity: website,
    recent_activity: website,
  };
}

export function hasNonEmptySourceActivity(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  return parseSourceActivity(stats ?? {}).length > 0;
}

export function hasRealSourceActivity(stats: Record<string, unknown> | null | undefined): boolean {
  const entries = parseSourceActivity(stats ?? {});
  return entries.some((e) => e.status !== "starting");
}

export function hasNonEmptyWebsiteActivity(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  return parseWebsiteActivity(stats ?? {}).length > 0;
}

export function hasRealWebsiteActivity(stats: Record<string, unknown> | null | undefined): boolean {
  return parseWebsiteActivity(stats ?? {}).some((e) => !e.id.startsWith("bootstrap:"));
}

function pickTelemetryFields(
  stats: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in stats) out[key] = stats[key];
  }
  return out;
}

const SOURCE_TELEMETRY_KEYS = [
  "source_activity",
  "source_activity_count",
  "source_activity_updated_at",
] as const;

const WEBSITE_TELEMETRY_KEYS = ["website_activity", "recent_activity"] as const;

function mergeProvidersInPlace(
  bootstrap: SourceActivityEntry[],
  incoming: SourceActivityEntry[],
): SourceActivityEntry[] {
  const byProvider = new Map<string, SourceActivityEntry>();
  for (const entry of bootstrap) byProvider.set(entry.provider, entry);
  for (const entry of incoming) byProvider.set(entry.provider, entry);
  return [...byProvider.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function mergeWebsiteEvents(
  bootstrap: ScanActivityEvent[],
  incoming: ScanActivityEvent[],
): ScanActivityEvent[] {
  const real = incoming.filter((e) => !e.id.startsWith("bootstrap:"));
  if (real.length > 0) return real;
  return bootstrap;
}

export function rememberNonEmptyScanTelemetry(
  previous: Record<string, unknown> | null | undefined,
  polled: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!hasNonEmptySourceActivity(polled) && !hasNonEmptyWebsiteActivity(polled)) {
    return previous ?? null;
  }
  const next = { ...(previous ?? {}), ...polled };
  if (hasRealSourceActivity(polled)) {
    Object.assign(next, pickTelemetryFields(polled, [...SOURCE_TELEMETRY_KEYS]));
  } else if (previous && hasNonEmptySourceActivity(previous)) {
    Object.assign(next, pickTelemetryFields(previous, [...SOURCE_TELEMETRY_KEYS]));
  }
  if (hasRealWebsiteActivity(polled)) {
    Object.assign(next, pickTelemetryFields(polled, [...WEBSITE_TELEMETRY_KEYS]));
  } else if (previous && hasNonEmptyWebsiteActivity(previous)) {
    Object.assign(next, pickTelemetryFields(previous, [...WEBSITE_TELEMETRY_KEYS]));
  }
  if (typeof polled.workflow_stage === "string") {
    next.workflow_stage = polled.workflow_stage;
  }
  return next;
}

/**
 * Precedence: real non-empty backend telemetry → last non-empty telemetry → bootstrap.
 */
export function mergeActiveScanStats(input: {
  listStats?: Record<string, unknown> | null;
  detailStats?: Record<string, unknown> | null;
  bootstrap?: ScanBootstrapState | null;
  lastKnown?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const polled = mergeCopyrightPollStats(input.listStats, input.detailStats);
  const bootstrapStats = input.bootstrap ? bootstrapStatsFromState(input.bootstrap) : null;
  const lastKnown = input.lastKnown ?? null;

  const bootstrapProviders = bootstrapStats ? parseSourceActivity(bootstrapStats) : [];
  const bootstrapWebsites = bootstrapStats ? parseWebsiteActivity(bootstrapStats) : [];

  let sourceTelemetry: Record<string, unknown> | null = null;
  if (hasRealSourceActivity(polled)) {
    sourceTelemetry = pickTelemetryFields(polled, [...SOURCE_TELEMETRY_KEYS]);
  } else if (lastKnown && hasNonEmptySourceActivity(lastKnown)) {
    sourceTelemetry = pickTelemetryFields(lastKnown, [...SOURCE_TELEMETRY_KEYS]);
  } else if (hasNonEmptySourceActivity(polled)) {
    sourceTelemetry = pickTelemetryFields(polled, [...SOURCE_TELEMETRY_KEYS]);
  } else if (bootstrapStats) {
    sourceTelemetry = pickTelemetryFields(bootstrapStats, [...SOURCE_TELEMETRY_KEYS]);
  }

  let websiteTelemetry: Record<string, unknown> | null = null;
  if (hasRealWebsiteActivity(polled)) {
    websiteTelemetry = pickTelemetryFields(polled, [...WEBSITE_TELEMETRY_KEYS]);
  } else if (lastKnown && hasRealWebsiteActivity(lastKnown)) {
    websiteTelemetry = pickTelemetryFields(lastKnown, [...WEBSITE_TELEMETRY_KEYS]);
  } else if (hasNonEmptyWebsiteActivity(polled)) {
    websiteTelemetry = pickTelemetryFields(polled, [...WEBSITE_TELEMETRY_KEYS]);
  } else if (lastKnown && hasNonEmptyWebsiteActivity(lastKnown)) {
    websiteTelemetry = pickTelemetryFields(lastKnown, [...WEBSITE_TELEMETRY_KEYS]);
  } else if (bootstrapStats) {
    websiteTelemetry = pickTelemetryFields(bootstrapStats, [...WEBSITE_TELEMETRY_KEYS]);
  }

  const workflowStage =
    typeof polled.workflow_stage === "string"
      ? polled.workflow_stage
      : typeof lastKnown?.workflow_stage === "string"
        ? lastKnown.workflow_stage
        : bootstrapStats?.workflow_stage;

  const mergedProviders = mergeProvidersInPlace(
    bootstrapProviders,
    parseSourceActivity({
      ...polled,
      ...(sourceTelemetry ?? {}),
    }),
  );

  const mergedWebsites = mergeWebsiteEvents(
    bootstrapWebsites,
    parseWebsiteActivity({
      ...polled,
      ...(websiteTelemetry ?? {}),
    }),
  );

  const withWorkflow = {
    ...polled,
    ...(workflowStage ? { workflow_stage: workflowStage } : {}),
    ...(sourceTelemetry ?? {}),
    ...(websiteTelemetry ?? {}),
    scan_bootstrap: Boolean(
      bootstrapStats &&
      !hasRealSourceActivity(polled) &&
      !(lastKnown && hasRealSourceActivity(lastKnown)),
    ),
  };

  const withProviders = mergeSourceActivityIntoStats(withWorkflow, mergedProviders);
  return {
    ...withProviders,
    website_activity: mergedWebsites,
    recent_activity: mergedWebsites,
  };
}

export function isActiveScanStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "running" || status === "pending";
}

export function bootstrapReelOperationalCards(providers: ScanBootstrapProvider[]): Array<{
  key: string;
  title: string;
  subtitle: string;
  badge: string;
}> {
  return providers.map((p) => ({
    key: `bootstrap-provider-${p.provider}`,
    title: p.label,
    subtitle: "Initializing channel",
    badge: "starting",
  }));
}

export function providerLabel(provider: string): string {
  return sourceActivityLabel(provider);
}
