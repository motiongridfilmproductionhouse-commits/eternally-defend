/**
 * Rejection-funnel diagnostics for Copyright Intelligence scans.
 * Explains 0-match outcomes without weakening classification gates.
 */

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
  };
}

/** Human-readable funnel explanation for empty client-visible result sets. */
export function explainZeroMatchFunnel(stats: Record<string, unknown> | null | undefined): string[] {
  const d = diagnosticsFromStats(stats);
  const n = (key: string) => {
    const v = stats?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const lines: string[] = [];

  const knownSubmitted = n("known_urls_submitted");
  const knownAccepted = n("known_urls_accepted");
  const knownRejected = n("known_urls_rejected");
  if (knownSubmitted > 0 || knownAccepted > 0 || knownRejected > 0) {
    lines.push(
      `Known URLs: ${knownSubmitted} submitted, ${knownAccepted} safely accepted, ${knownRejected} rejected (unsafe/DNS/redirect/duplicate) — seeds only, never auto-guilty.`,
    );
  }

  lines.push(
    `Discovery: ${d.queries_generated} queries generated, ${d.queries_executed} executed, ${d.provider_results} provider results, ${d.unique_candidate_pages} unique candidate pages.`,
  );
  lines.push(
    `Crawl: ${d.pages_crawled} pages crawled (${d.pages_failed} failed), ${d.listing_pages_found} listing/search pages, ${d.detail_pages_followed} title-detail pages followed.`,
  );
  lines.push(
    `Rejected: ${d.title_identity_rejected} lacking exact title identity, ${d.hard_negative_rejected} hard negatives (cinema/trailer/review/social/official), ${d.access_evidence_rejected} lacking distribution-access evidence, ${d.artwork_only_rejected} artwork-only.`,
  );
  lines.push(
    `Access signals seen: ${d.access_evidence_pages} pages with access evidence, ${d.embedded_players} embedded players, ${d.download_pages} download pages, ${d.file_host_destinations} file-host, ${d.torrents_magnets} torrent/magnet, ${d.theatre_print_findings} theatre-print.`,
  );
  lines.push(
    `Outcome: ${d.internal_leads_persisted} internal leads retained, ${d.client_visible_findings} client-visible piracy findings (require exact title + exact-page access evidence).`,
  );

  if (d.queries_executed === 0 && d.provider_results === 0) {
    lines.push("Primary bottleneck: discovery returned no provider results — check Firecrawl configuration and query coverage.");
  } else if (d.pages_crawled === 0) {
    lines.push("Primary bottleneck: no candidate pages were crawled for exact-page distribution evidence.");
  } else if (d.pages_failed > 0 && d.pages_failed >= d.pages_crawled * 0.6) {
    lines.push("Primary bottleneck: most exact-page crawls failed or returned empty content (fail closed).");
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
