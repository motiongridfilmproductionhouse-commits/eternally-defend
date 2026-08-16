/**
 * Radar dataset builders for the Eterna Command Center.
 *
 * Both radars are computed from ONE dataset: the tenant's open (`hidden_at IS NULL`)
 * `scan_hits` rows inside the dashboard's 14-day window. Every displayed count,
 * platform total and reach figure below is derived from that same array, so the
 * headline numbers always reconcile against the markers.
 *
 * No randomness, no fixtures, no fabricated telemetry: geometry is a pure
 * function of stored fields, so a finding keeps its position until its own data
 * changes.
 */
import { bucketPlatform, type Sev } from "@/lib/command-center-helpers";

export type ReachProvenance = "PROVIDER_REPORTED" | "ESTIMATED" | "VERIFIED" | "UNKNOWN";

export type RadarRow = {
  id: string;
  source: string | null;
  severity: string | null;
  risk_score: number | string | null;
  threat_score: number | string | null;
  risk_type: string | null;
  reach: number | string | null;
  title: string | null;
  canonical_url: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  first_seen_at: string | null;
  times_detected: number | null;
};

const SEV_ORDER: Sev[] = ["Critical", "High", "Medium", "Low", "Info"];
const SEV_NORM: Record<Sev, number> = { Critical: 1, High: 0.8, Medium: 0.55, Low: 0.3, Info: 0.1 };

/** Canonical severity label; unknown/missing values fall back to `Info`. */
export function normSeverity(raw: string | null | undefined): Sev {
  if (!raw) return "Info";
  const k = (raw[0]?.toUpperCase() ?? "") + raw.slice(1).toLowerCase();
  return (SEV_ORDER as string[]).includes(k) ? (k as Sev) : "Info";
}

/** Host of the stored URL, used for the domain label and the sector key. */
export function rowDomain(row: RadarRow): string | null {
  const url = row.canonical_url || row.permalink;
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Stable 0..1 from a string — used only to spread markers *inside* their own sector. */
export function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Reach provenance.
 *
 * `scan_hits.reach` is written at scan time from the platform-reported audience
 * metric (`metrics.views` / follower counts) returned by the source provider.
 * When the provider returned no audience metric the column stays 0, which means
 * "unknown", NOT "zero people saw this".
 */
export function reachProvenance(row: RadarRow): ReachProvenance {
  const reach = Number(row.reach ?? 0);
  if (!Number.isFinite(reach) || reach <= 0) return "UNKNOWN";
  return "PROVIDER_REPORTED";
}

export type DeepMarker = {
  id: string;
  findingId: string;
  findingTable: "scan_hits";
  platform: string;
  domain: string | null;
  findingType: string;
  severity: Sev;
  /** Stored risk score (0-100) — the only confidence-style value persisted for a hit. */
  confidence: number | null;
  threatScore: number;
  detectedAt: string | null;
  status: "OPEN" | "ESCALATED";
  url: string | null;
  thumbnail: string | null;
  title: string;
  timesDetected: number;
  /** Sector centre of the marker's platform, plus in-sector offset. Degrees. */
  angleDeg: number;
  /** 0 = centre, 1 = outer ring. Higher priority ⇒ closer to the centre. */
  radiusFactor: number;
};

export type DeepScopeDataset = {
  markers: DeepMarker[];
  /** Findings in the qualifying dataset (may exceed markers when capped). */
  signalCount: number;
  markerCount: number;
  platformCount: number;
  severityCounts: Record<Sev, number>;
  sectors: Array<{ platform: string; angleDeg: number; count: number }>;
  formula: { angle: string; radius: string };
};

const MARKER_CAP = 120;

/**
 * Deep Scope Radar dataset.
 *
 * angle  = centre of the finding's platform sector (platforms sorted by name for
 *          stability, 360° split evenly) ± up to 40% of the sector width, offset
 *          deterministically by the finding id so co-located findings stay apart.
 * radius = rMaxFactor of priority, priority = 0.65·severity + 0.35·recency(14d).
 *          Higher priority sits CLOSER to the centre (scope convention).
 */
export function buildDeepScope(rows: RadarRow[], escalatedUrls: Set<string>): DeepScopeDataset {
  const severityCounts: Record<Sev, number> = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Info: 0,
  };
  for (const r of rows) severityCounts[normSeverity(r.severity)]++;

  const platforms = [...new Set(rows.map((r) => bucketPlatform(r.source ?? "")))].sort();
  const sectorWidth = platforms.length ? 360 / platforms.length : 360;
  const sectorIndex = new Map(platforms.map((p, i) => [p, i]));

  const now = Date.now();
  const WINDOW_MS = 14 * 86_400_000;

  const markers: DeepMarker[] = rows.map((r) => {
    const platform = bucketPlatform(r.source ?? "");
    const severity = normSeverity(r.severity);
    const idx = sectorIndex.get(platform) ?? 0;
    const centre = idx * sectorWidth + sectorWidth / 2;
    const angleDeg = (centre + (hash01(r.id) - 0.5) * sectorWidth * 0.8 + 360) % 360;

    const seen = r.first_seen_at ? Date.parse(r.first_seen_at) : NaN;
    const recency = Number.isFinite(seen)
      ? Math.max(0, Math.min(1, 1 - (now - seen) / WINDOW_MS))
      : 0;
    const priority = SEV_NORM[severity] * 0.65 + recency * 0.35;

    const url = r.canonical_url || r.permalink || null;
    const risk = r.risk_score ?? null;

    return {
      id: r.id,
      findingId: r.id,
      findingTable: "scan_hits" as const,
      platform,
      domain: rowDomain(r),
      findingType: r.risk_type || "unclassified",
      severity,
      confidence: risk === null ? null : Math.round(Number(risk)),
      threatScore: Math.round(Number(r.threat_score ?? 0)),
      detectedAt: r.first_seen_at ?? null,
      status: url && escalatedUrls.has(url) ? ("ESCALATED" as const) : ("OPEN" as const),
      url,
      thumbnail: r.thumbnail_url ?? null,
      title: r.title || url || "Untitled finding",
      timesDetected: Number(r.times_detected ?? 1),
      angleDeg,
      radiusFactor: 0.18 + (1 - priority) * 0.78,
    };
  });

  markers.sort(
    (a, b) =>
      a.radiusFactor - b.radiusFactor ||
      (a.detectedAt && b.detectedAt ? (a.detectedAt < b.detectedAt ? 1 : -1) : 0),
  );

  return {
    markers: markers.slice(0, MARKER_CAP),
    signalCount: rows.length,
    markerCount: Math.min(markers.length, MARKER_CAP),
    platformCount: platforms.length,
    severityCounts,
    sectors: platforms.map((p) => ({
      platform: p,
      angleDeg: (sectorIndex.get(p) ?? 0) * sectorWidth + sectorWidth / 2,
      count: rows.filter((r) => bucketPlatform(r.source ?? "") === p).length,
    })),
    formula: {
      angle: "platform sector centre (alphabetical, 360°/platforms) ± 40% sector width by finding id",
      radius:
        "0.18 + (1 − priority) × 0.78, priority = 0.65·severity + 0.35·recency(14d); higher priority is closer to the centre",
    },
  };
}

export type ExposureMarker = {
  id: string;
  findingId: string;
  platform: string;
  domain: string | null;
  severity: Sev;
  title: string;
  url: string | null;
  reach: number;
  reachProvenance: ReachProvenance;
  detectedAt: string | null;
  /** Number of duplicate findings collapsed into this URL (1 = unique). */
  duplicatesMerged: number;
  angleDeg: number;
  radiusFactor: number;
};

export type ExposureDataset = {
  markers: ExposureMarker[];
  /** Findings with a usable reach value after URL de-duplication. */
  qualifyingCount: number;
  /** Findings in the dataset with no stored reach — excluded from the total. */
  unknownReachCount: number;
  /** Duplicate rows collapsed by canonical URL before ranking. */
  duplicatesCollapsed: number;
  /** Sum of reach over the de-duplicated qualifying findings only. */
  totalReach: number;
  maxReach: number;
  provenanceBreakdown: Record<ReachProvenance, number>;
  formula: { angle: string; radius: string; total: string };
};

const EXPOSURE_MARKER_CAP = 8;

/**
 * Exposure Bearing Radar dataset.
 *
 * De-duplicates by canonical URL (keeping the highest reach + severity for the
 * URL), keeps only findings with stored reach, then:
 *   angle  = same platform sector scheme as the Deep Scope radar.
 *   radius = 0.28 + 0.68 · log10(reach+1)/log10(maxReach+1) → the highest-reach
 *            qualifying finding always lands furthest from the centre.
 * totalReach = Σ reach over exactly those de-duplicated qualifying findings.
 * Unknown reach is NEVER counted as 0.
 */
export function buildExposure(rows: RadarRow[]): ExposureDataset {
  const provenanceBreakdown: Record<ReachProvenance, number> = {
    VERIFIED: 0,
    PROVIDER_REPORTED: 0,
    ESTIMATED: 0,
    UNKNOWN: 0,
  };
  for (const r of rows) provenanceBreakdown[reachProvenance(r)]++;

  // De-duplicate by the audience-bearing URL: two rows pointing at the same
  // content describe ONE audience and must not be summed twice.
  const byUrl = new Map<string, { row: RadarRow; reach: number; dupes: number }>();
  let unknownReachCount = 0;
  let duplicatesCollapsed = 0;

  for (const r of rows) {
    if (reachProvenance(r) === "UNKNOWN") {
      unknownReachCount++;
      continue;
    }
    const key = (r.canonical_url || r.permalink || `id:${r.id}`).replace(/[?#].*$/, "");
    const reach = Number(r.reach ?? 0);
    const cur = byUrl.get(key);
    if (!cur) byUrl.set(key, { row: r, reach, dupes: 1 });
    else {
      duplicatesCollapsed++;
      cur.dupes++;
      if (reach > cur.reach) {
        cur.reach = reach;
        cur.row = r;
      }
    }
  }

  const unique = [...byUrl.values()];
  const totalReach = unique.reduce((s, u) => s + u.reach, 0);
  const maxReach = unique.reduce((m, u) => Math.max(m, u.reach), 0);

  const platforms = [...new Set(rows.map((r) => bucketPlatform(r.source ?? "")))].sort();
  const sectorWidth = platforms.length ? 360 / platforms.length : 360;
  const sectorIndex = new Map(platforms.map((p, i) => [p, i]));
  const logMax = Math.log10(maxReach + 1) || 1;

  const markers: ExposureMarker[] = unique
    .sort((a, b) => b.reach - a.reach)
    .slice(0, EXPOSURE_MARKER_CAP)
    .map(({ row, reach, dupes }) => {
      const platform = bucketPlatform(row.source ?? "");
      const idx = sectorIndex.get(platform) ?? 0;
      const centre = idx * sectorWidth + sectorWidth / 2;
      return {
        id: row.id,
        findingId: row.id,
        platform,
        domain: rowDomain(row),
        severity: normSeverity(row.severity),
        title: row.title || row.canonical_url || "Untitled finding",
        url: row.canonical_url || row.permalink || null,
        reach,
        reachProvenance: reachProvenance(row),
        detectedAt: row.first_seen_at ?? null,
        duplicatesMerged: dupes,
        angleDeg: (centre + (hash01(`${row.id}:exposure`) - 0.5) * sectorWidth * 0.6 + 360) % 360,
        radiusFactor: 0.28 + 0.68 * (Math.log10(reach + 1) / logMax),
      };
    });

  return {
    markers,
    qualifyingCount: unique.length,
    unknownReachCount,
    duplicatesCollapsed,
    totalReach,
    maxReach,
    provenanceBreakdown,
    formula: {
      angle: "same platform sector scheme as Deep Scope (alphabetical, 360°/platforms)",
      radius: "0.28 + 0.68 × log10(reach+1)/log10(maxReach+1)",
      total:
        "Σ reach over URL-de-duplicated findings that have stored reach; findings with unknown reach are excluded, not zeroed",
    },
  };
}
