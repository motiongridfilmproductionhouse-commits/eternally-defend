/**
 * Rejection-funnel diagnostics for Copyright Intelligence scans.
 * Explains 0-match outcomes without weakening classification gates.
 */

import { CRAWL_FAILURE_CATEGORIES } from "./crawl-failure";

export interface CopyrightScanDiagnostics {
  queries_generated: number;
  queries_executed: number;
  provider_results: number;
  unique_candidate_pages: number;
  listing_pages_found: number;
  detail_pages_followed: number;
  pages_crawled: number;
  pages_failed: number;
  title_identity_rejected: number;
  hard_negative_rejected: number;
  access_evidence_rejected: number;
  internal_leads_persisted: number;
  client_visible_findings: number;
  cinema_showtime_rejected: number;
  trailer_promo_rejected: number;
  review_news_rejected: number;
  social_discussion_rejected: number;
  artwork_only_rejected: number;
  access_evidence_pages: number;
  embedded_players: number;
  download_pages: number;
  file_host_destinations: number;
  torrents_magnets: number;
  theatre_print_findings: number;
  known_urls_submitted: number;
  known_urls_accepted: number;
  known_urls_attempted: number;
  known_urls_retrieved: number;
  known_urls_rendered: number;
  known_urls_verified: number;
  known_urls_rejected: number;
  official_authorized_rejected: number;
  catalog_listing_rejected: number;
  youtube_promotional_rejected: number;
  registered_monitored_sources: number;
}

export function diagnosticsFromStats(
  stats: Record<string, unknown> | null | undefined,
): CopyrightScanDiagnostics {
  const n = (key: string) => {
    const v = stats?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    queries_generated: n("queries_generated"),
    queries_executed: n("queries_executed"),
    provider_results: n("provider_results") || n("provider_candidates") || n("candidates"),
    unique_candidate_pages: n("unique_candidate_pages"),
    listing_pages_found: n("listing_pages_found"),
    detail_pages_followed: n("detail_pages_followed"),
    pages_crawled: n("pages_crawled"),
    pages_failed: n("pages_failed"),
    title_identity_rejected: n("title_identity_rejected"),
    hard_negative_rejected: n("hard_negative_rejected"),
    access_evidence_rejected: n("access_evidence_rejected"),
    internal_leads_persisted: n("internal_leads_persisted") || n("leads"),
    client_visible_findings:
      n("client_visible_findings") ||
      n("verified_client_visible_findings") ||
      n("matches"),
    cinema_showtime_rejected: n("cinema_showtime_rejected"),
    trailer_promo_rejected: n("trailer_promo_rejected"),
    review_news_rejected: n("review_news_rejected"),
    social_discussion_rejected: n("social_discussion_rejected"),
    artwork_only_rejected: n("artwork_only_rejected"),
    access_evidence_pages: n("access_evidence_pages"),
    embedded_players: n("embedded_players"),
    download_pages: n("download_pages"),
    file_host_destinations: n("file_host_destinations"),
    torrents_magnets: n("torrents_magnets"),
    theatre_print_findings: n("theatre_print_findings"),
    known_urls_submitted: n("known_urls_submitted"),
    known_urls_accepted: n("known_urls_accepted"),
    known_urls_attempted: n("known_urls_attempted"),
    known_urls_retrieved: n("known_urls_retrieved"),
    known_urls_rendered: n("known_urls_rendered"),
    known_urls_verified: n("known_urls_verified"),
    known_urls_rejected:
      n("known_urls_rejected") + n("known_urls_rejected_after_crawl"),
    official_authorized_rejected: n("official_authorized_rejected"),
    catalog_listing_rejected: n("catalog_listing_rejected"),
    youtube_promotional_rejected: n("youtube_promotional_rejected"),
    registered_monitored_sources: n("registered_monitored_sources"),
  };
}

function crawlFailureBreakdownLines(stats: Record<string, unknown> | null | undefined): string[] {
  const raw = stats?.crawl_failed_by_category;
  if (!raw || typeof raw !== "object") return [];
  const counts = raw as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of CRAWL_FAILURE_CATEGORIES) {
    const n = counts[key];
    if (typeof n === "number" && n > 0) parts.push(`${key}: ${n}`);
  }
  return parts.length ? [`Crawl failures by category: ${parts.join(", ")}.`] : [];
}

function knownUrlFailureLines(stats: Record<string, unknown> | null | undefined): string[] {
  const reasons = stats?.known_url_failure_reasons;
  if (!Array.isArray(reasons) || !reasons.length) return [];
  return reasons.slice(0, 5).map((row) => {
    const r = row as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : "known URL";
    const category = typeof r.category === "string" ? r.category : "unknown";
    const reason = typeof r.reason === "string" ? r.reason : "no detail";
    return `Known URL outcome: ${url} → ${category}: ${reason}`;
  });
}

/** Human-readable funnel explanation for empty client-visible result sets. */
export function explainZeroMatchFunnel(stats: Record<string, unknown> | null | undefined): string[] {
  const d = diagnosticsFromStats(stats);
  const lines: string[] = [];

  if (d.known_urls_submitted > 0 || d.known_urls_accepted > 0 || d.known_urls_attempted > 0) {
    lines.push(
      `Known URLs: ${d.known_urls_submitted} submitted, ${d.known_urls_accepted} accepted, ${d.known_urls_attempted} attempted, ${d.known_urls_retrieved} retrieved, ${d.known_urls_rendered} rendered, ${d.known_urls_verified} verified, ${d.known_urls_rejected} rejected — seeds only, never auto-guilty.`,
    );
  }
  lines.push(...knownUrlFailureLines(stats));

  lines.push(
    `Discovery: ${d.queries_generated} queries generated, ${d.queries_executed} executed, ${d.provider_results} provider results, ${d.unique_candidate_pages} unique candidate pages.`,
  );
  lines.push(
    `Crawl: ${d.pages_crawled} pages crawled (${d.pages_failed} failed), ${d.listing_pages_found} listing/search pages, ${d.detail_pages_followed} title-detail pages followed.`,
  );
  lines.push(...crawlFailureBreakdownLines(stats));
  lines.push(
    `Rejected (content gates on retrieved pages only): ${d.title_identity_rejected} lacking exact title identity, ${d.hard_negative_rejected} hard negatives (cinema/trailer/review/social/official), ${d.access_evidence_rejected} lacking distribution-access evidence, ${d.artwork_only_rejected} artwork-only. Official/catalog ${d.official_authorized_rejected}/${d.catalog_listing_rejected}, YouTube promo ${d.youtube_promotional_rejected}.`,
  );
  lines.push(
    `Access signals seen: ${d.access_evidence_pages} pages with access evidence, ${d.embedded_players} embedded players, ${d.download_pages} download pages, ${d.file_host_destinations} file-host, ${d.torrents_magnets} torrent/magnet, ${d.theatre_print_findings} theatre-print.`,
  );
  lines.push(
    `Outcome: ${d.internal_leads_persisted} internal leads retained, ${d.client_visible_findings} client-visible piracy findings, ${d.registered_monitored_sources} monitored sources created (require exact title + exact-page access evidence).`,
  );

  if (d.known_urls_accepted > 0 && d.known_urls_retrieved === 0) {
    lines.push(
      "Primary bottleneck: accepted known URL(s) could not be retrieved (network/render failure) — not a content rejection.",
    );
  } else if (d.known_urls_retrieved > 0 && d.known_urls_verified === 0 && d.client_visible_findings === 0) {
    lines.push(
      "Primary bottleneck: known URL(s) were retrieved but failed exact-title identity and/or distribution-access evidence gates.",
    );
  } else if (d.queries_executed === 0 && d.provider_results === 0 && d.known_urls_attempted === 0) {
    lines.push("Primary bottleneck: discovery returned no provider results — check Firecrawl configuration and query coverage.");
  } else if (d.pages_crawled === 0) {
    lines.push("Primary bottleneck: no candidate pages were crawled for exact-page distribution evidence.");
  } else if (d.pages_failed > 0 && d.pages_failed >= d.pages_crawled * 0.6) {
    lines.push("Primary bottleneck: most exact-page crawls failed or returned empty content (fail closed; not content rejection).");
  } else if (d.hard_negative_rejected > 0 && d.access_evidence_pages === 0) {
    lines.push("Primary bottleneck: candidates were cinema/trailer/review/official pages without independent distribution access.");
  } else if (d.title_identity_rejected > 0 && d.client_visible_findings === 0) {
    lines.push("Primary bottleneck: crawled pages did not establish exact-title identity for the protected work.");
  } else if (d.access_evidence_rejected > 0 && d.client_visible_findings === 0) {
    lines.push("Primary bottleneck: title-matched pages lacked playable/download/torrent/file-host access evidence.");
  } else if (d.detail_pages_followed === 0 && d.listing_pages_found > 0) {
    lines.push("Primary bottleneck: listing/search pages were found but no title-matched detail pages were followed.");
  }

  return lines;
}
