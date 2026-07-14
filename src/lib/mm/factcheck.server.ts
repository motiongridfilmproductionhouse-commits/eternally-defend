/**
 * Google Fact Check Tools API client.
 * Docs: https://developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims/search
 */
import { getProviderConfig, ok, unavailable, failed, type ProviderResult } from "./providers.server";

export interface FactCheckReview {
  publisher: { name?: string; site?: string };
  url?: string;
  title?: string;
  reviewDate?: string;
  textualRating?: string;
  languageCode?: string;
}

export interface FactCheckClaim {
  text?: string;
  claimant?: string;
  claimDate?: string;
  claimReview?: FactCheckReview[];
}

export interface FactCheckResponse {
  claims?: FactCheckClaim[];
  nextPageToken?: string;
}

export async function searchFactChecks(
  query: string,
  opts: { languageCode?: string; maxAgeDays?: number; pageSize?: number } = {},
): Promise<ProviderResult<FactCheckResponse>> {
  const cfg = getProviderConfig();
  if (cfg.factCheck === "stub" || !cfg.factCheckApiKey) {
    return unavailable("Fact Check Tools API key not configured");
  }
  const q = query.trim();
  if (!q) return ok({ claims: [] });

  const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
  url.searchParams.set("key", cfg.factCheckApiKey);
  url.searchParams.set("query", q);
  url.searchParams.set("pageSize", String(opts.pageSize ?? 10));
  if (opts.languageCode) url.searchParams.set("languageCode", opts.languageCode);
  if (opts.maxAgeDays) url.searchParams.set("maxAgeDays", String(opts.maxAgeDays));

  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text();
      return failed(`Fact Check API [${res.status}]: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as FactCheckResponse;
    return ok(json);
  } catch (e) {
    return failed(`Fact Check network error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export type FactCheckStatus =
  | "previously_reviewed"
  | "rated_false"
  | "rated_misleading"
  | "rated_partly_false"
  | "supported"
  | "conflicting"
  | "no_existing_fact_check"
  | "insufficient_match"
  | "requires_human_review";

export function classifyReviews(reviews: FactCheckReview[]): FactCheckStatus {
  if (!reviews.length) return "no_existing_fact_check";
  const ratings = reviews.map((r) => (r.textualRating ?? "").toLowerCase());
  const falseCount = ratings.filter((r) => /\bfalse\b|fake|hoax|debunk|incorrect/.test(r)).length;
  const misleadingCount = ratings.filter((r) => /mislead|manipulat|out of context/.test(r)).length;
  const partlyCount = ratings.filter((r) => /partly|partial|half|mixture/.test(r)).length;
  const trueCount = ratings.filter((r) => /\btrue\b|correct|accurate|supported/.test(r)).length;

  if (falseCount && trueCount) return "conflicting";
  if (falseCount) return "rated_false";
  if (misleadingCount) return "rated_misleading";
  if (partlyCount) return "rated_partly_false";
  if (trueCount) return "supported";
  return "previously_reviewed";
}
