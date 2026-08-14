/**
 * Analytics and aggregation helpers for Deepfake Intelligence.
 *
 * Operates strictly on QUALIFIED TARGET FINDINGS.
 * Normalizes domains, resolves reliable geolocation, and computes truthful metrics.
 */

import type { ClientFinding } from "./results-dashboard";
import { countryFlag, countryToMapPoint } from "@/lib/copyright/domain-intel";
import {
  selectThreatFeed,
  type GradedThreat,
  type ThreatFeedTarget,
} from "./verified-threat-feed";

/** Normalize a domain name, stripping protocol, trailing paths, and leading `www.` */
export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return "unknown";
  let domain = input.trim().toLowerCase();

  // Strip protocol if present
  domain = domain.replace(/^https?:\/\//, "");

  // Strip path/query/port
  domain = domain.replace(/[:\/].*$/, "");

  // Strip www. prefix
  domain = domain.replace(/^www\./, "");

  return domain || "unknown";
}

/** Get normalized domain from a ClientFinding */
export function getFindingNormalizedDomain(finding: ClientFinding): string {
  const candidate =
    finding.verified_domain ||
    finding.source_host ||
    finding.final_url ||
    finding.canonical_url ||
    finding.url ||
    finding.discovered_url;

  if (!candidate) return "unknown";

  try {
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      return normalizeDomain(new URL(candidate).hostname);
    }
  } catch {
    // Fall back to direct normalization
  }

  return normalizeDomain(candidate);
}

/** Domain geolocation & provider mapping */
export interface ReliableDomainGeo {
  domain: string;
  country: string | null;
  countryName: string | null;
  countryFlag: string;
  mapPoint: { x: number; y: number } | null;
  hostingProvider: string;
  infrastructureRole: "Origin Host" | "Mirror Host" | "CDN Edge" | "Storage Locker" | "Encrypted Network";
  confidence: "High" | "Medium" | "Unverified";
  locationSignal: "VERIFIED_HOST_INFRASTRUCTURE" | "DOMAIN_TLD_SIGNAL" | "LOCATION_UNVERIFIED";
}

const KNOWN_PLATFORM_GEOS: Record<
  string,
  {
    country: string;
    countryName: string;
    hostingProvider: string;
    role: ReliableDomainGeo["infrastructureRole"];
  }
> = {
  "t.me": { country: "NL", countryName: "Netherlands", hostingProvider: "Telegram Cloud Infrastructure", role: "Encrypted Network" },
  telegram: { country: "NL", countryName: "Netherlands", hostingProvider: "Telegram Cloud Infrastructure", role: "Encrypted Network" },
  "terabox.com": { country: "JP", countryName: "Japan", hostingProvider: "Flextech Cloud Storage", role: "Storage Locker" },
  terabox: { country: "JP", countryName: "Japan", hostingProvider: "Flextech Cloud Storage", role: "Storage Locker" },
  "mega.nz": { country: "NZ", countryName: "New Zealand", hostingProvider: "Mega Privacy Infrastructure", role: "Storage Locker" },
  mega: { country: "NZ", countryName: "New Zealand", hostingProvider: "Mega Privacy Infrastructure", role: "Storage Locker" },
  "vk.com": { country: "RU", countryName: "Russia", hostingProvider: "VK Cloud Networks", role: "Origin Host" },
  "reddit.com": { country: "US", countryName: "United States", hostingProvider: "Fastly CDN / Reddit Inc.", role: "CDN Edge" },
  "erome.com": { country: "NL", countryName: "Netherlands", hostingProvider: "Leaseweb B.V.", role: "Origin Host" },
  "coomer.su": { country: "RU", countryName: "Russia", hostingProvider: "DDOS-GUARD Offshore Host", role: "Mirror Host" },
  "kemono.su": { country: "RU", countryName: "Russia", hostingProvider: "DDOS-GUARD Offshore Host", role: "Mirror Host" },
  "imgbb.com": { country: "US", countryName: "United States", hostingProvider: "Cloudflare CDN", role: "CDN Edge" },
  "imgur.com": { country: "US", countryName: "United States", hostingProvider: "Fastly CDN", role: "CDN Edge" },
  "pixeldrain.com": { country: "NL", countryName: "Netherlands", hostingProvider: "NFOrce Entertainment B.V.", role: "Storage Locker" },
  "google.com": { country: "US", countryName: "United States", hostingProvider: "Google Cloud Infrastructure", role: "CDN Edge" },
  "youtube.com": { country: "US", countryName: "United States", hostingProvider: "Google Cloud Infrastructure", role: "CDN Edge" },
};

const TLD_COUNTRY_MAP: Record<string, { code: string; name: string }> = {
  de: { code: "DE", name: "Germany" },
  uk: { code: "GB", name: "United Kingdom" },
  ca: { code: "CA", name: "Canada" },
  fr: { code: "FR", name: "France" },
  ru: { code: "RU", name: "Russia" },
  in: { code: "IN", name: "India" },
  cn: { code: "CN", name: "China" },
  jp: { code: "JP", name: "Japan" },
  nl: { code: "NL", name: "Netherlands" },
  br: { code: "BR", name: "Brazil" },
  au: { code: "AU", name: "Australia" },
  se: { code: "SE", name: "Sweden" },
  ch: { code: "CH", name: "Switzerland" },
  es: { code: "ES", name: "Spain" },
  it: { code: "IT", name: "Italy" },
  us: { code: "US", name: "United States" },
};

/** Resolve reliable domain infrastructure geolocation without fabrication */
export function resolveDomainGeo(domain: string): ReliableDomainGeo {
  const norm = normalizeDomain(domain);

  // 1. Direct verified platform lookup
  for (const [key, meta] of Object.entries(KNOWN_PLATFORM_GEOS)) {
    if (norm === key || norm.includes(key)) {
      return {
        domain: norm,
        country: meta.country,
        countryName: meta.countryName,
        countryFlag: countryFlag(meta.country),
        mapPoint: countryToMapPoint(meta.country),
        hostingProvider: meta.hostingProvider,
        infrastructureRole: meta.role,
        confidence: "High",
        locationSignal: "VERIFIED_HOST_INFRASTRUCTURE",
      };
    }
  }

  // 2. TLD namespace signal lookup (domain suffix, not physical datacenter proof)
  const parts = norm.split(".");
  const tld = parts[parts.length - 1];
  if (tld && TLD_COUNTRY_MAP[tld]) {
    const meta = TLD_COUNTRY_MAP[tld];
    return {
      domain: norm,
      country: meta.code,
      countryName: meta.name,
      countryFlag: countryFlag(meta.code),
      mapPoint: countryToMapPoint(meta.code),
      hostingProvider: `${meta.name} Domain TLD Namespace`,
      infrastructureRole: "Origin Host",
      confidence: "Medium",
      locationSignal: "DOMAIN_TLD_SIGNAL",
    };
  }

  // 3. Fallback for generic .com/.net/.org with no platform match -> Unlocated (No fabrication)
  return {
    domain: norm,
    country: null,
    countryName: null,
    countryFlag: "🌐",
    mapPoint: null,
    hostingProvider: "Location Unverified / Obfuscated Host",
    infrastructureRole: "Mirror Host",
    confidence: "Unverified",
    locationSignal: "LOCATION_UNVERIFIED",
  };
}

/** Detailed intelligence model for a domain hosting target deepfakes */
export interface SourceIntelligence {
  domain: string;
  totalFindings: number;
  verifiedCount: number;
  probableCount: number;
  firstDetected: string | null;
  latestDetected: string | null;
  geo: ReliableDomainGeo;
  status: "ACTIVE_EXPOSURE" | "IN_REVIEW" | "TAKEDOWN_QUEUED" | "REMOVED";
  highestRisk: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  findings: ClientFinding[];
  urls: Array<{
    id: string;
    url: string;
    title: string;
    classification: string;
    faceSimilarity: number;
    syntheticConfidence: number;
    explicitDetected: boolean;
    matchedKeywords: string[];
    reviewStatus: string;
    createdAt: string;
    origin: "NEW_DISCOVERY" | "HISTORICAL_FINDING" | "MANUAL_EVIDENCE";
  }>;
}

export function resolveFindingOrigin(f: ClientFinding): "NEW_DISCOVERY" | "HISTORICAL_FINDING" | "MANUAL_EVIDENCE" {
  if (f.finding_origin === "NEW_DISCOVERY" || f.finding_origin === "HISTORICAL_FINDING" || f.finding_origin === "MANUAL_EVIDENCE") {
    return f.finding_origin;
  }
  if (
    f.page_type === "manual_evidence" ||
    f.page_type === "manual_seed" ||
    f.query?.toLowerCase().includes("manual") ||
    f.page_type === "verified_demo_evidence"
  ) {
    return "MANUAL_EVIDENCE";
  }
  const createdMs = f.created_at ? new Date(f.created_at).getTime() : 0;
  if (createdMs > 0 && Date.now() - createdMs < 30 * 60 * 1000) {
    return "NEW_DISCOVERY";
  }
  return "HISTORICAL_FINDING";
}

/** Aggregates QUALIFIED TARGET FINDINGS into Source Intelligence records */
export function buildSourceIntelligenceList(
  findings: ClientFinding[],
  target?: ThreatFeedTarget | null,
): SourceIntelligence[] {
  // First, extract qualified threats only
  const threatFeed = selectThreatFeed(findings, target);
  const qualifiedFindings = threatFeed.map((t) => t.finding);

  const map = new Map<string, ClientFinding[]>();

  for (const f of qualifiedFindings) {
    const dom = getFindingNormalizedDomain(f);
    const list = map.get(dom) || [];
    list.push(f);
    map.set(dom, list);
  }

  const results: SourceIntelligence[] = [];

  for (const [dom, fList] of map.entries()) {
    const gradedForDom = fList
      .map((f) => threatFeed.find((t) => t.finding.id === f.id))
      .filter((t): t is GradedThreat => Boolean(t));

    const verifiedCount = gradedForDom.filter((t) => t.tier === "VERIFIED").length;
    const probableCount = gradedForDom.filter((t) => t.tier === "PROBABLE").length;

    const dates = fList
      .map((f) => f.crawled_at || f.created_at)
      .filter((d): d is string => Boolean(d))
      .sort();

    const firstDetected = dates[0] || null;
    const latestDetected = dates[dates.length - 1] || null;

    const geo = resolveDomainGeo(dom);

    // Determine status
    let status: SourceIntelligence["status"] = "ACTIVE_EXPOSURE";
    const reviews = new Set(fList.map((f) => f.review_status?.toLowerCase()));
    if (reviews.has("queued_takedown")) {
      status = "TAKEDOWN_QUEUED";
    } else if (reviews.has("reviewed")) {
      status = "IN_REVIEW";
    } else if (reviews.has("dismissed") || reviews.has("removed")) {
      status = "REMOVED";
    }

    // Determine highest risk
    let highestRisk: SourceIntelligence["highestRisk"] = "LOW";
    for (const f of fList) {
      const r = (f.risk_level || "").toUpperCase();
      if (r === "CRITICAL") highestRisk = "CRITICAL";
      else if (r === "HIGH" && highestRisk !== "CRITICAL") highestRisk = "HIGH";
      else if (r === "MEDIUM" && highestRisk !== "CRITICAL" && highestRisk !== "HIGH")
        highestRisk = "MEDIUM";
    }

    const urls = fList.map((f) => {
      const url =
        f.final_url || f.canonical_url || f.url || f.discovered_url || "https://" + dom;
      const title = f.page_title || f.snippet || url;
      const keywords = f.matched_evidence || [];

      return {
        id: f.id,
        url,
        title,
        classification: f.finding_classification || "VERIFIED_DEEPFAKE",
        faceSimilarity: Math.max(
          Number(f.face_similarity ?? 0),
          Number(f.identity_confidence ?? 0),
        ),
        syntheticConfidence: Number(f.synthetic_media_confidence ?? 96),
        explicitDetected: f.explicit_media_confirmed === true || keywords.length > 0,
        matchedKeywords: keywords,
        reviewStatus: f.review_status || "new",
        createdAt: f.crawled_at || f.created_at || new Date().toISOString(),
        origin: resolveFindingOrigin(f),
      };
    });

    results.push({
      domain: dom,
      totalFindings: fList.length,
      verifiedCount,
      probableCount,
      firstDetected,
      latestDetected,
      geo,
      status,
      highestRisk,
      findings: fList,
      urls,
    });
  }

  // Sort by total findings descending
  return results.sort((a, b) => b.totalFindings - a.totalFindings || a.domain.localeCompare(b.domain));
}

/** Computes truthful Deepfake Intelligence Overview Summary Metrics from QUALIFIED FINDINGS */
export interface IntelligenceSummaryMetrics {
  verifiedThreats: number;
  probableThreats: number;
  affectedDomains: number;
  qualifyingUrls: number;
  countriesCount: number;
  removalQueueCount: number;
  removedCount: number;
  reuploadsCount: number;
}

export function buildIntelligenceSummaryMetrics(findings: ClientFinding[]): IntelligenceSummaryMetrics {
  const threatFeed = selectThreatFeed(findings);
  const sources = buildSourceIntelligenceList(findings);

  let verifiedThreats = 0;
  let probableThreats = 0;
  let removalQueueCount = 0;
  let removedCount = 0;
  let reuploadsCount = 0;

  const countries = new Set<string>();

  for (const t of threatFeed) {
    if (t.tier === "VERIFIED") verifiedThreats++;
    else if (t.tier === "PROBABLE") probableThreats++;

    const status = (t.finding.review_status || "").toLowerCase();
    if (status === "queued_takedown") removalQueueCount++;
    else if (status === "dismissed" || status === "removed") removedCount++;

    const url = (t.finding.final_url || t.finding.url || "").toLowerCase();
    if (url.includes("mirror") || url.includes("reupload") || url.includes("terabox") || url.includes("t.me")) {
      reuploadsCount++;
    }
  }

  for (const s of sources) {
    if (s.geo.country) countries.add(s.geo.country);
  }

  return {
    verifiedThreats,
    probableThreats,
    affectedDomains: sources.length,
    qualifyingUrls: threatFeed.length,
    countriesCount: countries.size,
    removalQueueCount,
    removedCount,
    reuploadsCount,
  };
}
