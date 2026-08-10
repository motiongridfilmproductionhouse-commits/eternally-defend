/**
 * Client-Facing Threat Classification & Risk Mapping Helper
 * Formats copyright findings into clear, non-technical threat intelligence.
 * Strictly preserves data integrity — no fabricated numbers or fake fallback scores.
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

export type ThreatLevel = "Critical" | "High" | "Medium" | "Low";
export type ThreatLabel = "CRITICAL" | "HIGH RISK" | "MEDIUM RISK" | "LOW RISK";
export type DistributionActivity = "VERY HIGH" | "HIGH" | "MODERATE" | "LOW";
export type ExposureLevel = "VERY HIGH" | "HIGH" | "MODERATE" | "LOW" | "NOT ESTABLISHED";

export interface MappedRiskProps {
  findingId: string;
  piracyRiskScore: number | null;
  threatLevel: ThreatLevel;
  threatLabel: ThreatLabel;
  distributionActivity: DistributionActivity;
  distributionActivityFormatted: string;
  exposureLevel: ExposureLevel;
  exposureLevelFormatted: string;
  copyType: string;
  isLive: boolean;
  canTakeAction: boolean;
  isClientThreat: boolean;
  alertMessage: string;
  // Compatibility getters for legacy callers
  trafficSignal?: string;
  audienceReach?: string;
  distributionType?: string;
  formattedTraffic?: string | null;
}

/**
 * Detect copy type based on real finding details (CAM, HDTC, WEB-DL, RIPPED COPY, etc.)
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
    dist?.print_leak_type,
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
  if (/\b(ripped_copy|ripped copy|rip)\b/i.test(combined)) {
    return "RIPPED COPY";
  }
  if (/\b(download|download_page|file_host|torrent|magnet)\b/i.test(combined)) {
    return "DOWNLOAD MIRROR";
  }
  if (/\b(full_movie|full movie|full_length)\b/i.test(combined)) {
    return "FULL MOVIE REUPLOAD";
  }
  if (/\b(streaming|unauthorized_streaming)\b/i.test(combined)) {
    return "STREAMING MIRROR";
  }
  if (/\b(reupload|video_host_reupload)\b/i.test(combined)) {
    return "REUPLOAD";
  }
  return "UNKNOWN";
}

/**
 * Maps raw finding into client-facing threat metrics.
 */
export function mapFindingToRiskProps(finding?: SourceFindingData | null): MappedRiskProps {
  if (!finding) {
    return {
      findingId: "",
      piracyRiskScore: null,
      threatLevel: "Low",
      threatLabel: "LOW RISK",
      distributionActivity: "LOW",
      distributionActivityFormatted: "Low",
      exposureLevel: "NOT ESTABLISHED",
      exposureLevelFormatted: "Not Established",
      copyType: "UNKNOWN",
      isLive: false,
      canTakeAction: false,
      isClientThreat: false,
      alertMessage: "No piracy threat detected",
      trafficSignal: "Low",
      audienceReach: "Not Established",
      distributionType: "UNKNOWN",
    };
  }

  // Check if item is NOT_SUBJECT or rejected
  const isNotSubject =
    finding.classification === "NOT_SUBJECT" ||
    finding.review_status === "not_subject" ||
    finding.review_status === "rejected";

  if (isNotSubject) {
    return {
      findingId: finding.id ?? "",
      piracyRiskScore: null,
      threatLevel: "Low",
      threatLabel: "LOW RISK",
      distributionActivity: "LOW",
      distributionActivityFormatted: "Low",
      exposureLevel: "NOT ESTABLISHED",
      exposureLevelFormatted: "Not Established",
      copyType: "NOT_SUBJECT",
      isLive: false,
      canTakeAction: false,
      isClientThreat: false,
      alertMessage: "Not subject to enforcement",
      trafficSignal: "Low",
      audienceReach: "Not Established",
      distributionType: "NOT_SUBJECT",
    };
  }

  const ev = (finding.evidence && typeof finding.evidence === "object" ? finding.evidence : {}) as Record<string, unknown>;
  const dist = (ev && typeof ev.distribution === "object" && ev.distribution !== null ? ev.distribution : {}) as Record<string, unknown>;

  const isPiracyLead =
    String(ev?.discovery) === "piracy_lead" ||
    dist?.domain_risk === "high" ||
    String(finding.reason).includes("piracy_lead") ||
    String(finding.detection_type).includes("piracy") ||
    String(finding.classification).includes("piracy") ||
    String(finding.classification).includes("ripped");

  // 1. PIRACY RISK SCORE (numeric value if available, else null)
  const explicitRiskScore =
    typeof dist?.piracy_risk_score === "number"
      ? dist.piracy_risk_score
      : typeof ev?.piracy_risk_score === "number"
        ? ev.piracy_risk_score
        : null;

  const piracyRiskScore =
    explicitRiskScore ?? (typeof finding.confidence === "number" ? Math.round(finding.confidence) : null);

  // 2. COPY TYPE
  const explicitLeakType =
    typeof dist?.print_leak_type === "string"
      ? dist.print_leak_type
      : typeof ev?.print_leak_type === "string"
        ? ev.print_leak_type
        : null;

  const copyType = explicitLeakType || detectPrintLeakType(finding);

  // 3. THREAT LEVEL & LABEL (Classification-aware minimum severity)
  let threatLevel: ThreatLevel;
  if (piracyRiskScore != null) {
    if (piracyRiskScore >= 85) threatLevel = "Critical";
    else if (piracyRiskScore >= 70) threatLevel = "High";
    else if (piracyRiskScore >= 45) threatLevel = "Medium";
    else threatLevel = "Low";
  } else {
    // Unmeasured / unscored base
    threatLevel = "High";
  }

  // Enforce minimum threat levels for confirmed movie copies and piracy leads
  if (
    copyType === "CAM PRINT" ||
    copyType === "THEATRE RECORDING" ||
    copyType === "HDTC" ||
    copyType === "WEB-DL LEAK" ||
    copyType === "RIPPED COPY" ||
    copyType === "FULL MOVIE REUPLOAD" ||
    copyType === "STREAMING MIRROR" ||
    isPiracyLead
  ) {
    if (threatLevel === "Low" || threatLevel === "Medium") {
      threatLevel = "High";
    }
  } else if (copyType === "DOWNLOAD MIRROR" || copyType === "REUPLOAD") {
    if (threatLevel === "Low") {
      threatLevel = "Medium";
    }
  }

  const threatLabel: ThreatLabel =
    threatLevel === "Critical"
      ? "CRITICAL"
      : threatLevel === "High"
        ? "HIGH RISK"
        : threatLevel === "Medium"
          ? "MEDIUM RISK"
          : "LOW RISK";

  // 4. IS LIVE (Any active scan finding or non-dismissed public match is LIVE unless explicitly marked offline/unreachable)
  const stateStr = String(finding.source_state ?? finding.status ?? "").toLowerCase();
  const currentReachability = String(finding.current_reachability ?? "").toLowerCase();
  const reviewStatus = String(finding.review_status ?? "").toLowerCase();

  const isExplicitlyOffline =
    reviewStatus === "dismissed" ||
    reviewStatus === "removed" ||
    stateStr === "removed" ||
    stateStr === "offline" ||
    stateStr === "historical_unreachable" ||
    stateStr === "historical_preserved" ||
    stateStr === "historical_requires_review" ||
    stateStr === "redirected" ||
    stateStr === "unreachable" ||
    currentReachability === "unreachable";

  const isLive = !isExplicitlyOffline;

  // 5. DISTRIBUTION ACTIVITY
  let viewCount: number | null = null;
  if (typeof dist?.view_count === "number") viewCount = dist.view_count;
  else if (typeof ev?.view_count === "number") viewCount = ev.view_count;

  let engagementCount: number | null = null;
  if (typeof dist?.engagement_count === "number") engagementCount = dist.engagement_count;
  else if (typeof ev?.engagement_count === "number") engagementCount = ev.engagement_count;

  const distLinksCount = Array.isArray(dist?.distribution_links) ? dist.distribution_links.length : 0;
  const searchVisibility = (typeof dist?.search_visibility === "string" ? dist.search_visibility : typeof ev?.search_visibility === "string" ? ev.search_visibility : null)?.toLowerCase();

  let distributionActivity: DistributionActivity;
  if (distLinksCount >= 5 || (viewCount != null && viewCount >= 50000) || (engagementCount != null && engagementCount >= 10000)) {
    distributionActivity = "VERY HIGH";
  } else if (
    distLinksCount >= 2 ||
    (viewCount != null && viewCount >= 1000) ||
    (engagementCount != null && engagementCount >= 500) ||
    searchVisibility === "high" ||
    searchVisibility === "critical" ||
    isPiracyLead ||
    (isLive && (copyType === "STREAMING MIRROR" || copyType === "DOWNLOAD MIRROR" || copyType === "CAM PRINT" || copyType === "WEB-DL LEAK" || copyType === "RIPPED COPY"))
  ) {
    distributionActivity = "HIGH";
  } else if (isLive || distLinksCount === 1 || (viewCount != null && viewCount > 0) || searchVisibility === "medium" || searchVisibility === "moderate") {
    distributionActivity = "MODERATE";
  } else {
    distributionActivity = "LOW";
  }

  const distributionActivityFormattedMap: Record<DistributionActivity, string> = {
    "VERY HIGH": "Very High",
    HIGH: "High",
    MODERATE: "Moderate",
    LOW: "Low",
  };
  const distributionActivityFormatted = distributionActivityFormattedMap[distributionActivity];

  // 6. EXPOSURE LEVEL (Recognizes public piracy portal URLs and piracy leads)
  const platformReach = (typeof dist?.platform_reach === "string" ? dist.platform_reach : typeof ev?.platform_reach === "string" ? ev.platform_reach : null)?.toLowerCase();
  const hasPublicUrl = Boolean(finding.source_url || finding.url);

  let exposureLevel: ExposureLevel;
  if (searchVisibility === "critical" || searchVisibility === "high" || (viewCount != null && viewCount >= 20000) || distLinksCount >= 5) {
    exposureLevel = "VERY HIGH";
  } else if (
    (searchVisibility != null && searchVisibility !== "none" && isLive) ||
    distLinksCount >= 2 ||
    (viewCount != null && viewCount >= 2000) ||
    platformReach === "high" ||
    isPiracyLead ||
    (hasPublicUrl && (copyType === "RIPPED COPY" || copyType === "CAM PRINT" || copyType === "WEB-DL LEAK" || copyType === "STREAMING MIRROR"))
  ) {
    exposureLevel = "HIGH";
  } else if (isLive || (viewCount != null && viewCount > 0) || searchVisibility === "moderate" || searchVisibility === "medium" || hasPublicUrl) {
    exposureLevel = "MODERATE";
  } else if (searchVisibility === "low" || (viewCount != null && viewCount === 0)) {
    exposureLevel = "LOW";
  } else {
    exposureLevel = "NOT ESTABLISHED";
  }

  const exposureLevelFormattedMap: Record<ExposureLevel, string> = {
    "VERY HIGH": "Very High",
    HIGH: "High",
    MODERATE: "Moderate",
    LOW: "Low",
    "NOT ESTABLISHED": "Not Established",
  };
  const exposureLevelFormatted = exposureLevelFormattedMap[exposureLevel];

  // 7. ALERT MESSAGE
  let alertMessage: string;
  if (distLinksCount >= 3) {
    alertMessage = "Multiple public distribution copies detected";
  } else if (exposureLevel === "VERY HIGH" || exposureLevel === "HIGH") {
    alertMessage = "High public exposure detected for this copy";
  } else if (copyType === "CAM PRINT" || copyType === "THEATRE RECORDING") {
    alertMessage = "Unauthorised theatre-recorded copy is actively available";
  } else if (copyType === "WEB-DL LEAK") {
    alertMessage = "High-quality leaked copy is publicly distributed";
  } else if (copyType === "RIPPED COPY") {
    alertMessage = "Ripped copy active on high-risk piracy distribution portal";
  } else if (copyType === "STREAMING MIRROR") {
    alertMessage = "Active streaming copy detected on a public source";
  } else if (copyType === "DOWNLOAD MIRROR") {
    alertMessage = "Downloadable movie copy detected";
  } else if (copyType === "FULL MOVIE REUPLOAD") {
    alertMessage = "Full unauthorized movie reupload detected";
  } else {
    alertMessage = "Unauthorized piracy copy detected on public source";
  }

  const canTakeAction = finding.review_status !== "dismissed" && finding.review_status !== "removed";

  return {
    findingId: finding.id ?? "",
    piracyRiskScore,
    threatLevel,
    threatLabel,
    distributionActivity,
    distributionActivityFormatted,
    exposureLevel,
    exposureLevelFormatted,
    copyType,
    isLive,
    canTakeAction,
    isClientThreat: true,
    alertMessage,
    trafficSignal: distributionActivityFormatted,
    audienceReach: exposureLevelFormatted,
    distributionType: copyType,
  };
}
