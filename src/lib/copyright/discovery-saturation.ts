/**
 * Adaptive discovery saturation: TARGET is a mode switch, not a stop threshold.
 * Discovery continues high-priority platform queries after the target unless
 * broad coverage (domains + platform categories) is already satisfied.
 */

import {
  MAX_DISCOVERY_CANDIDATES,
  SATURATION_DISCOVERY_CANDIDATES,
  TARGET_DISCOVERY_CANDIDATES,
  MIN_PLATFORM_CATEGORIES_FOR_BROAD_COVERAGE,
  MIN_UNIQUE_DOMAINS_FOR_BROAD_COVERAGE,
} from "./discovery-config";
import {
  platformCategoryForHost,
  platformCategoryForQuery,
  type PlatformCategory,
} from "./discovery-platform-registry";
import { hostOf } from "./url.server";
import type { DiscoveryQueryPlan } from "./discovery-query-stages";

export type DiscoveryMode = "full" | "coverage" | "saturation";

export interface DiscoveryCoverageState {
  uniqueCandidateUrls: number;
  uniqueDomains: number;
  platformCategoriesCovered: PlatformCategory[];
  highPriorityQueriesCompleted: number;
  targetReachedAt: number | null;
  activeRequestsCompletedAfterTarget: number;
}

export interface DiscoverySaturationMetrics {
  discovery_mode: DiscoveryMode;
  platform_categories_covered: PlatformCategory[];
  high_priority_queries_completed: number;
  providers_exhausted: boolean;
  stopped_low_priority_queries: number;
  active_requests_completed_after_target: number;
}

export function emptyDiscoveryCoverageState(): DiscoveryCoverageState {
  return {
    uniqueCandidateUrls: 0,
    uniqueDomains: 0,
    platformCategoriesCovered: [],
    highPriorityQueriesCompleted: 0,
    targetReachedAt: null,
    activeRequestsCompletedAfterTarget: 0,
  };
}

export function resolveDiscoveryMode(uniqueCandidateUrls: number): DiscoveryMode {
  if (uniqueCandidateUrls < TARGET_DISCOVERY_CANDIDATES) return "full";
  if (uniqueCandidateUrls < SATURATION_DISCOVERY_CANDIDATES) return "coverage";
  return "saturation";
}

export function hasBroadDiscoveryCoverage(state: DiscoveryCoverageState): boolean {
  if (state.uniqueCandidateUrls < TARGET_DISCOVERY_CANDIDATES) return false;
  return (
    state.uniqueDomains >= MIN_UNIQUE_DOMAINS_FOR_BROAD_COVERAGE &&
    state.platformCategoriesCovered.length >= MIN_PLATFORM_CATEGORIES_FOR_BROAD_COVERAGE
  );
}

/** Stage 2/3 expansion is unnecessary once target is met AND coverage is broad. */
export function shouldSkipStageExpansion(
  stage: 1 | 2 | 3,
  state: DiscoveryCoverageState,
): boolean {
  if (stage === 1) return false;
  const mode = resolveDiscoveryMode(state.uniqueCandidateUrls);
  if (mode === "full") return false;
  if (!hasBroadDiscoveryCoverage(state)) return false;
  return true;
}

export function isHighPriorityPlan(plan: DiscoveryQueryPlan): boolean {
  if (plan.priority) return true;
  if (plan.stage === 1) return true;
  if (plan.stage === 3 && /site:/i.test(plan.query)) return true;
  return false;
}

export function shouldIssueDiscoveryPlan(
  plan: DiscoveryQueryPlan,
  state: DiscoveryCoverageState,
): { issue: boolean; reason: string | null } {
  if (state.uniqueCandidateUrls >= MAX_DISCOVERY_CANDIDATES) {
    return { issue: false, reason: "max_discovery_candidates" };
  }

  const mode = resolveDiscoveryMode(state.uniqueCandidateUrls);
  const highPriority = isHighPriorityPlan(plan);
  const page = plan.page ?? 1;
  const lowPriorityPagination = page > 1;
  const stageExpansion = plan.stage === 2 || plan.stage === 3;

  if (mode === "full") {
    return { issue: true, reason: null };
  }

  if (mode === "coverage") {
    if (stageExpansion && shouldSkipStageExpansion(plan.stage, state)) {
      return { issue: false, reason: "stopped_low_priority_stage" };
    }
    if (lowPriorityPagination) {
      return { issue: false, reason: "stopped_low_priority_pagination" };
    }
    if (!highPriority && !stageExpansion) {
      return { issue: false, reason: "stopped_low_priority_query" };
    }
    return { issue: true, reason: null };
  }

  // saturation — only high-priority exact-title / site-specific queries
  if (!highPriority) {
    return { issue: false, reason: "stopped_low_priority_query" };
  }
  if (lowPriorityPagination) {
    return { issue: false, reason: "stopped_low_priority_pagination" };
  }
  return { issue: true, reason: null };
}

export function expandPlansForDiscoveryMode(
  basePlans: DiscoveryQueryPlan[],
  mode: DiscoveryMode,
  priorityQueryPages: number,
): DiscoveryQueryPlan[] {
  const plans: DiscoveryQueryPlan[] = [];
  for (const plan of basePlans) {
    plans.push({ ...plan, page: plan.page ?? 1 });
    if (!plan.priority) continue;
    const maxPage =
      mode === "full"
        ? priorityQueryPages
        : mode === "coverage"
          ? 1
          : 1;
    for (let page = 2; page <= maxPage; page++) {
      plans.push({ ...plan, page });
    }
  }
  return plans;
}

export function buildCoverageStateFromPageKeys(
  uniquePageKeys: Iterable<string>,
  prior: DiscoveryCoverageState = emptyDiscoveryCoverageState(),
): DiscoveryCoverageState {
  const domains = new Set<string>();
  const categories = new Set<PlatformCategory>(prior.platformCategoriesCovered);
  let count = 0;
  for (const url of uniquePageKeys) {
    count += 1;
    const host = hostOf(url);
    if (host) {
      domains.add(host.toLowerCase());
      const cat = platformCategoryForHost(host);
      if (cat) categories.add(cat);
    }
  }
  const targetReachedAt =
    prior.targetReachedAt ??
    (count >= TARGET_DISCOVERY_CANDIDATES ? Date.now() : null);
  return {
    ...prior,
    uniqueCandidateUrls: count,
    uniqueDomains: domains.size,
    platformCategoriesCovered: [...categories],
    targetReachedAt,
  };
}

export function updateCoverageStateFromUrls(
  state: DiscoveryCoverageState,
  urls: string[],
): DiscoveryCoverageState {
  return buildCoverageStateFromPageKeys(urls, state);
}

export function recordCompletedDiscoveryQuery(
  state: DiscoveryCoverageState,
  plan: DiscoveryQueryPlan,
  ok: boolean,
): DiscoveryCoverageState {
  const next = { ...state };
  if (ok && isHighPriorityPlan(plan)) {
    next.highPriorityQueriesCompleted += 1;
  }
  if (ok && state.targetReachedAt != null) {
    next.activeRequestsCompletedAfterTarget += 1;
  }
  return next;
}

export function recordQueryCategoryFromPlan(
  state: DiscoveryCoverageState,
  plan: DiscoveryQueryPlan,
): DiscoveryCoverageState {
  const cat = platformCategoryForQuery(plan.query);
  if (!cat || state.platformCategoriesCovered.includes(cat)) return state;
  return {
    ...state,
    platformCategoriesCovered: [...state.platformCategoriesCovered, cat],
  };
}

export function buildSaturationMetrics(input: {
  state: DiscoveryCoverageState;
  stoppedLowPriorityQueries: number;
  providersExhausted: boolean;
}): DiscoverySaturationMetrics {
  return {
    discovery_mode: resolveDiscoveryMode(input.state.uniqueCandidateUrls),
    platform_categories_covered: [...input.state.platformCategoriesCovered],
    high_priority_queries_completed: input.state.highPriorityQueriesCompleted,
    providers_exhausted: input.providersExhausted,
    stopped_low_priority_queries: input.stoppedLowPriorityQueries,
    active_requests_completed_after_target: input.state.activeRequestsCompletedAfterTarget,
  };
}
