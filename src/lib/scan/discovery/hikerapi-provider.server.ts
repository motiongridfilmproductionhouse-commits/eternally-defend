/**
 * HikerAPI discovery adapter — Instagram account search, registered in the
 * DiscoveryRouter alongside Brave/SerpApi/Google/Gemini.
 *
 * Deliberately the CHEAPEST possible HikerAPI call (one account-search
 * request per query, no follow-on media/tagged/comments calls): the router
 * fans every discovery query out to every healthy provider, and a scan can
 * generate dozens of queries (aliases, AI-research expansions, etc.), so
 * anything more expensive here would defeat "cost-efficient discovery" the
 * moment HikerAPI is enabled. The deeper, per-profile capabilities (own
 * media, reels, tagged media, comments) live in ./hikerapi-instagram.server
 * and run at most once per scan, only for already-identity-linked handles —
 * see that file's header comment for the full cost-control rationale.
 *
 * Per-scan cost control for THIS tier specifically:
 *
 *   The router's own executed-query dedup (router.server.ts's
 *   `executedQueries`) only skips re-dispatching a duplicate query when the
 *   CALLER opts in with `{ skipDuplicates: true }` — several call sites in
 *   scan.ts don't (e.g. fcSearch), so the exact same normalized query can
 *   legitimately reach this adapter's search() more than once in one scan.
 *   Relying on that alone would not bound HikerAPI's cost. Instead this
 *   module keeps its own per-scan cache + hard request cap, scoped via a
 *   WeakMap keyed on the current scan's DiscoveryRouter instance — the same
 *   per-request object every provider already resolves via
 *   currentDiscoveryRouter() (backed by AsyncLocalStorage in router.server,
 *   set up once per POST /api/scan request). Reusing that as the scope
 *   means: no new context-propagation mechanism, and the state is garbage
 *   collected automatically once the scan's router instance is no longer
 *   referenced (no manual cleanup, no cross-scan leakage).
 *
 *   - Identical/normalized-duplicate queries within one scan are served
 *     from cache — zero additional HikerAPI requests, regardless of how
 *     many times the router fans that query out.
 *   - Distinct queries consume from a hard per-scan budget
 *     (HIKERAPI_TIER1_MAX_REQUESTS_PER_SCAN, default 10). Once exhausted,
 *     search() returns [] — a normal empty result, not a thrown
 *     ProviderError — so the DiscoveryRouter's circuit breaker never marks
 *     HikerAPI "unhealthy" for this (budget exhaustion isn't a failure),
 *     and no other provider or the rest of the scan is ever affected.
 */

import { isHikerApiEnabled, searchAccounts, canonicalProfileUrl, HikerApiRequestBudget, type HikerUser } from "./hikerapi-client.server";
import { ProviderError, type SearchProviderAdapter } from "./provider";
import type { DiscoveryHit } from "./types";

function tier1MaxRequests(): number {
  const raw = Number(process.env.HIKERAPI_TIER1_MAX_REQUESTS_PER_SCAN ?? 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50) : 10;
}

function usersToHits(users: HikerUser[], limit: number): DiscoveryHit[] {
  const capped = users.slice(0, Math.min(Math.max(limit, 1), 10));
  const hits: DiscoveryHit[] = [];
  for (const u of capped) {
    if (!u.username) continue;
    hits.push({
      url: canonicalProfileUrl(u.username),
      title: u.full_name || u.username,
      description: u.biography ?? undefined,
      author: u.username,
      media:
        u.profile_pic_url_hd || u.profile_pic_url
          ? { thumbnail: u.profile_pic_url ?? undefined, thumbnailHi: u.profile_pic_url_hd ?? undefined }
          : undefined,
      provider: "hikerapi",
      // Extra, non-DiscoveryHit-standard fields — the interface allows
      // arbitrary passthrough keys ([key: string]: unknown), and
      // hikerapi-instagram.server.ts's deep-dive step reads these back to
      // avoid a redundant getUserByUsername lookup for the same account.
      instagramUserId: String(u.pk),
      instagramIsPrivate: u.is_private ?? undefined,
      instagramIsVerified: u.is_verified ?? undefined,
      instagramFollowerCount: u.follower_count ?? undefined,
    });
  }
  return hits;
}

interface Tier1ScanState {
  budget: HikerApiRequestBudget;
  cache: Map<string, HikerUser[]>;
  budgetExhaustedLogged: boolean;
}

/**
 * Keyed on the scan's DiscoveryRouter instance (an object, valid WeakMap
 * key) rather than a string scan id — there is no string scan id available
 * at this layer, and the router instance itself is already the correct
 * per-scan lifetime.
 */
const scanState = new WeakMap<object, Tier1ScanState>();

async function stateForCurrentScan(): Promise<Tier1ScanState> {
  const { currentDiscoveryRouter } = await import("./router.server");
  const router = currentDiscoveryRouter();
  let state = scanState.get(router);
  if (!state) {
    state = {
      budget: new HikerApiRequestBudget(tier1MaxRequests()),
      cache: new Map(),
      budgetExhaustedLogged: false,
    };
    scanState.set(router, state);
  }
  return state;
}

export const hikerapiProvider: SearchProviderAdapter = {
  id: "hikerapi",
  label: "HikerAPI (Instagram)",

  isConfigured() {
    return isHikerApiEnabled();
  },

  async search(query, limit, signal) {
    if (!isHikerApiEnabled()) {
      throw new ProviderError("auth_failed", "HikerAPI is not enabled (HIKERAPI_ENABLED/HIKERAPI_ACCESS_KEY)");
    }

    const { normalizeQuery } = await import("./router.server");
    const key = normalizeQuery(query);
    const state = await stateForCurrentScan();

    const cached = state.cache.get(key);
    if (cached) return usersToHits(cached, limit);

    if (!state.budget.take()) {
      if (!state.budgetExhaustedLogged) {
        state.budgetExhaustedLogged = true;
        console.warn(
          `[scan:hikerapi] Tier-1 request budget (${tier1MaxRequests()}) exhausted for this scan — further Instagram account searches skipped; other providers unaffected.`,
        );
      }
      return [];
    }

    const users = await searchAccounts(query, signal);
    state.cache.set(key, users);
    return usersToHits(users, limit);
  },
};
