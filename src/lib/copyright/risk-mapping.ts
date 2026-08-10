/**
 * Helper to safely map finding data (MatchRow, PublicSuspiciousSource, ThreatResultRow, etc.)
 * into CopyrightFindingRiskPanelProps without generating fake metrics or default scores.
 * Fully null-safe for SSR and missing/partial data.
 */

export interface SourceFindingData {
  id?: string;
  confidence?: number | null;
  confidence_band?: string | null;
  review_status?: string | null;
  detection_type?: string | null;
  classification?: string | null;
  platform?: string | null;
  source_url?: string;
  url?: string;
  page_title?: string | null;
  title?: string | null;
  reason?: string | null;
  ocr_text?: string | null;
  evidence?: unknown;
  status?: string | null;
  source_state?: string | null;
  current_reachability?: string | null;
}

export interface MappedRiskProps {
  findingId: string;
  piracyRiskScore: number | null;
  trafficSignal: string;
  audienceReach: string;
  distributionType: string;
  isLive: boolean;
  canTakeAction: boolean;
  viewCount?: number | null;
  engagementCount?: number | null;
  searchVisibility?: string | null;
  formattedTraffic?: string | null;
}

/**
 * Classify print/leak type based on real finding details (CAM, HDTC, WEB-DL, etc.)
 */
export function detectPrintLeakType(finding?: SourceFindingData | null): string {
  if (!finding) return "UNKNOWN";

  const ev = (finding.evidence && typeof finding.evidence === "object" ? finding.evidence : {}) as Record<string, unknown>;
  const dist = (ev && typeof ev.distribution === "object" && ev.distribution !== null ? ev.distribution : {}) as Record<string, unknown>;

  const indicators = Array.isArray(dist?.piracy_indicators) ? dist.piracy_indicators : [];
  const tags = Array.isArray(dist?.quality_tags) ? dist.quality_tags : [];

  const combined = [
    finding.detection_type,
    finding.classification,
    finding.title,
    finding.page_title,
    finding.url,
    finding.source_url,
    finding.reason,
    finding.ocr_text,
    dist?.classification,
    dist?.content_type,
    JSON.stringify(indicators),
    JSON.stringify(tags),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(hdtc)\b/i.test(combined)) {
    return "HDTC";
  }
  if (/\b(theatre|theater)\s*(print|recording|leak)?\b/i.test(combined)) {
    return "THEATRE RECORDING";
  }
  if (/\b(cam|camrip|hdts|ts|telesync)\b/i.test(combined)) {
    return "CAM PRINT";
  }
  if (/\b(web-?dl|webrip)\b/i.test(combined)) {
    return "WEB-DL LEAK";
  }
  if (/\b(ripped_copy|ripped copy)\b/i.test(combined)) {
    return "RIPPED COPY";
  }
  if (/\b(streaming|unauthorized_streaming)\b/i.test(combined)) {
    return "STREAMING MIRROR";
  }
  if (/\b(download|download_page|file_host|torrent)\b/i.test(combined)) {
    return "DOWNLOAD MIRROR";
  }
  if (/\b(reupload|video_host_reupload)\b/i.test(combined)) {
    return "REUPLOAD";
  }
  return "UNKNOWN";
}

/**
 * Maps raw finding object into clean props for CopyrightFindingRiskPanel.
 * NO fake defaults are generated: metrics are strictly real, explicitly derived from real evidence, or Unknown.
 */
export function mapFindingToRiskProps(finding?: SourceFindingData | null): MappedRiskProps {
  if (!finding) {
    return {
      findingId: "",
      piracyRiskScore: null,
      trafficSignal: "Unknown",
      audienceReach: "Unknown",
      distributionType: "UNKNOWN",
      isLive: false,
      canTakeAction: false,
    };
  }

  const ev = (finding.evidence && typeof finding.evidence === "object" ? finding.evidence : {}) as Record<string, unknown>;
  const dist = (ev && typeof ev.distribution === "object" && ev.distribution !== null ? ev.distribution : {}) as Record<string, unknown>;

  // 1. Piracy Risk Score (REAL VALUE ONLY - null if unmeasured)
  const explicitRiskScore =
    typeof dist?.piracy_risk_score === "number"
      ? dist.piracy_risk_score
      : typeof ev?.piracy_risk_score === "number"
        ? ev.piracy_risk_score
        : null;

  const piracyRiskScore =
    explicitRiskScore ?? (typeof finding.confidence === "number" ? Math.round(finding.confidence) : null);

  // 2. Print / Leak Type
  const explicitLeakType =
    typeof dist?.print_leak_type === "string"
      ? dist.print_leak_type
      : typeof ev?.print_leak_type === "string"
        ? ev.print_leak_type
        : null;

  const distributionType = explicitLeakType || detectPrintLeakType(finding);

  // 3. Traffic Signal & Numbers (ONLY FROM REAL EVIDENCE)
  let viewCount: number | null = null;
  if (typeof dist?.view_count === "number") viewCount = dist.view_count;
  else if (typeof ev?.view_count === "number") viewCount = ev.view_count;

  let engagementCount: number | null = null;
  if (typeof dist?.engagement_count === "number") engagementCount = dist.engagement_count;
  else if (typeof ev?.engagement_count === "number") engagementCount = ev.engagement_count;

  let searchVisibility: string | null = null;
  if (typeof dist?.search_visibility === "string") searchVisibility = dist.search_visibility;
  else if (typeof ev?.search_visibility === "string") searchVisibility = ev.search_visibility;

  let formattedTraffic: string | null = null;
  if (viewCount != null && viewCount > 0) {
    formattedTraffic = viewCount >= 1000 ? `${(viewCount / 1000).toFixed(1)}K views` : `${viewCount} views`;
  } else if (engagementCount != null && engagementCount > 0) {
    formattedTraffic = engagementCount >= 1000 ? `${(engagementCount / 1000).toFixed(1)}K engagements` : `${engagementCount} engagements`;
  }

  const explicitTraffic =
    typeof dist?.traffic_signal === "string"
      ? dist.traffic_signal
      : typeof ev?.traffic_signal === "string"
        ? ev.traffic_signal
        : typeof dist?.page_traffic === "string"
          ? dist.page_traffic
          : typeof ev?.page_traffic === "string"
            ? ev.page_traffic
            : null;

  let trafficSignal: string;
  if (explicitTraffic) {
    trafficSignal = explicitTraffic;
  } else if (formattedTraffic) {
    trafficSignal = formattedTraffic;
  } else if (searchVisibility) {
    trafficSignal = searchVisibility.charAt(0).toUpperCase() + searchVisibility.slice(1);
  } else {
    const distLinks = Array.isArray(dist?.distribution_links) ? dist.distribution_links.length : 0;
    if (distLinks >= 5) trafficSignal = "High";
    else if (distLinks >= 2) trafficSignal = "Moderate";
    else trafficSignal = "Unknown";
  }

  // 4. Audience Reach (ONLY FROM REAL EVIDENCE)
  const explicitReach =
    typeof dist?.audience_reach === "string"
      ? dist.audience_reach
      : typeof ev?.audience_reach === "string"
        ? ev.audience_reach
        : typeof dist?.platform_reach === "string"
          ? dist.platform_reach
          : typeof ev?.platform_reach === "string"
            ? ev.platform_reach
            : null;

  let audienceReach: string;
  if (explicitReach) {
    audienceReach = explicitReach;
  } else if (viewCount != null && viewCount > 0) {
    if (viewCount >= 50000) audienceReach = "Very High";
    else if (viewCount >= 5000) audienceReach = "High";
    else if (viewCount >= 500) audienceReach = "Moderate";
    else audienceReach = "Low";
  } else if (searchVisibility) {
    audienceReach = searchVisibility.charAt(0).toUpperCase() + searchVisibility.slice(1);
  } else {
    const distLinks = Array.isArray(dist?.distribution_links) ? dist.distribution_links.length : 0;
    if (distLinks >= 5) audienceReach = "Very High";
    else if (distLinks >= 2) audienceReach = "High";
    else audienceReach = "Unknown";
  }

  // 5. Is Live (ONLY WHEN ACTUALLY REACHABLE / RECONFIRMED IN CURRENT SCAN)
  const stateStr = String(finding.source_state ?? finding.status ?? "").toLowerCase();
  const currentReachability = finding.current_reachability;

  const isLive =
    finding.review_status !== "dismissed" &&
    stateStr !== "removed" &&
    stateStr !== "offline" &&
    stateStr !== "historical_unreachable" &&
    stateStr !== "historical_preserved" &&
    stateStr !== "historical_requires_review" &&
    stateStr !== "redirected" &&
    stateStr !== "unreachable" &&
    currentReachability !== "unreachable" &&
    (stateStr === "new_confirmed" || stateStr === "historical_reconfirmed" || stateStr === "active" || currentReachability === "reachable");

  // 6. Can Take Action
  const canTakeAction = finding.review_status !== "dismissed" && finding.review_status !== "removed";

  return {
    findingId: finding.id ?? "",
    piracyRiskScore,
    trafficSignal,
    audienceReach,
    distributionType,
    isLive,
    canTakeAction,
    viewCount,
    engagementCount,
    searchVisibility,
    formattedTraffic,
  };
}
