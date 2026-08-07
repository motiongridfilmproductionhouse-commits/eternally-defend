/**
 * Persist initial Deepfake investigation queries at scan startup so the UI
 * leaves 0/0 immediately and workers resume from a durable checkpoint.
 */

import { expandIdentityVariants } from "./identity-variants.server";
import { generateDeepfakeQueries } from "./query-generator.server";
import { buildExecutedQueryPlan } from "./discovery-plan.server";
import { buildAdaptiveQuerySchedule } from "./query-priority.server";
import { INITIAL_PRIORITY_QUERY_COUNT } from "./scan-budget.server";
import { createEmptyCheckpoint, type ScanCheckpoint } from "./scan-checkpoint.server";
import { createDiscoveryFunnelMetrics, type DiscoveryFunnelMetrics } from "./scan-ownership.server";
import { createImportedImageQueries, parseGoogleImagesUrl } from "./google-images-import.server";

export type DeepfakeStartupPlan = {
  aliases: string[];
  queries: string[];
  checkpoint: ScanCheckpoint;
  metrics: DiscoveryFunnelMetrics;
};

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

export function buildStartupQueryList(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
  googleImagesUrl?: string;
  maxQueries: number;
}): string[] {
  const generatedQueries = generateDeepfakeQueries({
    name: input.name,
    aliases: input.aliases ?? [],
    handles: input.handles ?? [],
  }).slice(0, Math.max(1, input.maxQueries));

  let importedQueries: string[] = [];
  if (input.googleImagesUrl) {
    const imported = parseGoogleImagesUrl(input.googleImagesUrl);
    importedQueries = createImportedImageQueries(imported.query);
  }

  const merged = buildExecutedQueryPlan({
    importedQueries,
    generatedQueries,
    maxQueries: input.maxQueries,
  });
  const importedKeys = new Set(importedQueries.map((query) => query.toLowerCase()));
  const importedHead = merged.filter((query) => importedKeys.has(query.toLowerCase()));
  const remainder = merged.filter((query) => !importedKeys.has(query.toLowerCase()));
  const scheduledRemainder = buildAdaptiveQuerySchedule({
    queries: remainder,
    initialCount: INITIAL_PRIORITY_QUERY_COUNT,
  });

  return uniqueStrings([...importedHead, ...scheduledRemainder]).slice(0, input.maxQueries);
}

export function prepareDeepfakeStartupPlan(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
  profileId?: string | null;
  googleImagesUrl?: string;
  maxQueries?: number;
  perQueryLimit?: number;
}): DeepfakeStartupPlan {
  const maxQueries = input.maxQueries ?? 56;
  const perQueryLimit = input.perQueryLimit ?? 20;
  const autoAliases = expandIdentityVariants({
    name: input.name,
    aliases: input.aliases,
    handles: input.handles,
  });
  const aliases = uniqueStrings([...(input.aliases ?? []), ...autoAliases]).slice(0, 48);

  const queries = buildStartupQueryList({
    name: input.name,
    aliases,
    handles: input.handles,
    googleImagesUrl: input.googleImagesUrl,
    maxQueries,
  });

  const metrics = createDiscoveryFunnelMetrics();
  metrics.queries_generated = queries.length;
  metrics.aliases_generated = aliases.length;

  const checkpoint = createEmptyCheckpoint({
    queries,
    targetName: input.name,
    profileId: input.profileId ?? null,
    aliases,
    handles: input.handles ?? [],
    perQueryLimit,
    maxQueries,
    initialWaveCount: INITIAL_PRIORITY_QUERY_COUNT,
    metrics,
  });

  return { aliases, queries, checkpoint, metrics };
}
