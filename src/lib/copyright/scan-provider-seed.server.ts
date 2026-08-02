/**
 * Force-persist initial provider telemetry immediately after executor claim.
 * Canonical location: copyright_scans.stats.source_activity
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isFirecrawlConfigured } from "@/lib/firecrawl-client.server";
import { isBrightDataConfigured } from "@/lib/copyright/brightdata-provider.server";
import { isYoutubeConfigured } from "@/lib/copyright/reference-materials";
import {
  mergeSourceActivityIntoStats,
  type SourceActivityEntry,
} from "@/lib/copyright/source-activity";

export type ProviderSeedSupabase = Pick<SupabaseClient, "from">;

export function configuredCopyrightScanProviders(): Array<{ provider: string; label: string }> {
  const providers: Array<{ provider: string; label: string }> = [];
  if (isFirecrawlConfigured()) {
    providers.push({ provider: "firecrawl", label: "Firecrawl" });
  }
  if (isYoutubeConfigured()) {
    providers.push({ provider: "youtube", label: "YouTube" });
  }
  if (isBrightDataConfigured()) {
    providers.push({ provider: "bright_data", label: "Bright Data" });
  }
  return providers.sort((a, b) => a.label.localeCompare(b.label));
}

export function buildQueuedProviderSeedEntries(
  providers: Array<{ provider: string; label: string }>,
): SourceActivityEntry[] {
  const now = new Date().toISOString();
  return providers.map(({ provider, label }) => ({
    provider,
    label,
    status: "queued" as const,
    requests: 0,
    candidates: 0,
    failures: 0,
    updated_at: now,
  }));
}

export async function forcePersistCopyrightScanProviderSeed(opts: {
  supabase: ProviderSeedSupabase;
  scanId: string;
  scanStatus: string;
  priorStats: Record<string, unknown>;
}): Promise<{
  stats: Record<string, unknown>;
  rowCount: number;
  providers: string[];
}> {
  const configured = configuredCopyrightScanProviders();
  const providerNames = configured.map((p) => p.provider);
  const entries = buildQueuedProviderSeedEntries(configured);
  const payload = mergeSourceActivityIntoStats(opts.priorStats, entries);

  console.info("copyright_scan_provider_seed_start", {
    scan_id: opts.scanId,
    scan_status: opts.scanStatus,
    provider_count: providerNames.length,
    providers: providerNames,
  });
  console.info("copyright_scan_provider_seed_payload", {
    scan_id: opts.scanId,
    scan_status: opts.scanStatus,
    provider_count: providerNames.length,
    providers: providerNames,
  });

  try {
    const { data, error, count } = await opts.supabase
      .from("copyright_scans")
      .update({ stats: payload as never })
      .eq("id", opts.scanId)
      .eq("status", "running")
      .select("id, status, stats");

    if (error) {
      console.error("copyright_scan_provider_seed_write_error", {
        scan_id: opts.scanId,
        scan_status: opts.scanStatus,
        provider_count: providerNames.length,
        providers: providerNames,
        updated_row_count: 0,
        error: error.message,
      });
      throw new Error(`Provider seed write failed: ${error.message}`);
    }

    const rows = data ?? [];
    const rowCount = typeof count === "number" ? count : rows.length;

    if (rowCount === 0) {
      console.error("copyright_scan_provider_seed_write_zero_rows", {
        scan_id: opts.scanId,
        scan_status: opts.scanStatus,
        provider_count: providerNames.length,
        providers: providerNames,
        updated_row_count: 0,
      });
      throw new Error("Provider seed write updated zero rows.");
    }

    const updatedStats = ((rows[0] as { stats?: Record<string, unknown> } | undefined)?.stats ??
      payload) as Record<string, unknown>;

    console.info("copyright_scan_provider_seed_write_success", {
      scan_id: opts.scanId,
      scan_status: opts.scanStatus,
      provider_count: providerNames.length,
      providers: providerNames,
      updated_row_count: rowCount,
    });

    return {
      stats: updatedStats,
      rowCount,
      providers: providerNames,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Provider seed write failed:") ||
        error.message === "Provider seed write updated zero rows.")
    ) {
      throw error;
    }
    console.error("copyright_scan_provider_seed_write_error", {
      scan_id: opts.scanId,
      scan_status: opts.scanStatus,
      provider_count: providerNames.length,
      providers: providerNames,
      updated_row_count: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
