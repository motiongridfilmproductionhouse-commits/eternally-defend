/**
 * Pure, testable model for the Celebrity Live Protection Radar.
 *
 * Rules that this module enforces (and that the tests lock in):
 * - Every node comes from a real persisted finding. Nothing is synthesised.
 * - Campaign windows/approved lists only change INTERPRETATION (association),
 *   they never delete, hide or downgrade the underlying finding record.
 * - `red` is reserved for findings the existing evidence/classification
 *   pipeline already marked verified / high-confidence. A face similarity
 *   match on its own can never be red.
 * - No biometric identifiers (AWS FaceId, collection id, S3 key, vectors)
 *   are part of the normalized shape, so they cannot reach the client.
 */

export const FINDING_KINDS = [
  "reputation",
  "face_match",
  "deepfake",
  "impersonation",
  "copyright",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const ASSOCIATIONS = [
  "AUTHORIZED",
  "REVIEW",
  "POSSIBLE_UNAUTHORIZED_AD",
  "MISUSE",
] as const;
export type Association = (typeof ASSOCIATIONS)[number];

export type RadarColor = "green" | "yellow" | "orange" | "red";

export type CampaignContext = {
  id: string;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  official_urls: string[];
  approved_accounts: string[];
  approved_media_urls: string[];
  hashtags: string[];
};

/** Raw normalized finding — produced from a single persisted row. */
export type RawFinding = {
  kind: FindingKind;
  /** Underlying row id (used for deep links + association records). */
  id: string;
  /** Human category label derived from pipeline output only. */
  category: string;
  platform: string;
  title: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  /** 0-100 where the pipeline provides one. */
  confidence: number | null;
  /** Pipeline review/evidence status, verbatim-ish. */
  evidenceStatus: string;
  /** True only when the existing pipeline verified / high-confidence flagged it. */
  pipelineVerified: boolean;
  /** True when the pipeline itself marked the item as suspicious/high risk. */
  pipelineSuspicious: boolean;
  reach: number | null;
  detectedAt: string;
};

export type RadarFinding = RawFinding & {
  association: Association;
  campaignId: string | null;
  campaignName: string | null;
  color: RadarColor;
  angle: number;
  radius: number;
  deepLink: string;
};

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value: unknown): number | null {
  const n = num(value);
  if (n === null) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

export function platformFromUrl(url: string | null | undefined, fallback = "Web"): string {
  const u = (url ?? "").toLowerCase();
  if (!u) return fallback;
  if (u.includes("youtu")) return "YouTube";
  if (u.includes("instagram")) return "Instagram";
  if (u.includes("tiktok")) return "TikTok";
  if (u.includes("facebook") || u.includes("fb.com")) return "Facebook";
  if (u.includes("twitter") || u.includes("x.com")) return "X";
  if (u.includes("reddit")) return "Reddit";
  if (u.includes("telegram") || u.includes("t.me")) return "Telegram";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return fallback;
  }
}

const REPUTATION_CATEGORY: Array<[RegExp, string]> = [
  [/defam|libel|slander/, "Defamatory content"],
  [/impersonat|fake ?account/, "Impersonation"],
  [/deepfake|synthetic|face ?swap/, "Deepfake misuse"],
  [/endorse|sponsor|promo ?scam|scam ?ad/, "Fake endorsement"],
  [/advert|ad ?use|banner/, "Unauthorized advertisement"],
  [/copyright|piracy|re-?upload/, "Copyright misuse"],
  [/harass|abuse|hate/, "Harassment"],
  [/misinform|false|fake ?news|rumou?r/, "False claims"],
];

export function reputationCategory(riskType: string | null, tags: string[] | null): string {
  const bag = [riskType ?? "", ...(tags ?? [])].join(" ").toLowerCase();
  for (const [re, label] of REPUTATION_CATEGORY) if (re.test(bag)) return label;
  return "Reputation mention";
}

export type ReputationRow = {
  id: string;
  source: string | null;
  title: string | null;
  permalink: string | null;
  canonical_url: string | null;
  thumbnail_url: string | null;
  reach: number | null;
  severity: string | null;
  risk_type: string | null;
  tags: string[] | null;
  threat_score: number | null;
  risk_score: number | null;
  first_seen_at: string | null;
  published_at: string | null;
};

export function normalizeReputation(row: ReputationRow): RawFinding {
  const url = row.canonical_url ?? row.permalink ?? null;
  const severity = (row.severity ?? "").toLowerCase();
  const score = num(row.threat_score) ?? num(row.risk_score);
  const verified = severity === "critical" || (score !== null && score >= 8);
  return {
    kind: "reputation",
    id: row.id,
    category: reputationCategory(row.risk_type, row.tags),
    platform: row.source ?? platformFromUrl(url),
    title: row.title ?? null,
    url,
    thumbnailUrl: row.thumbnail_url ?? null,
    confidence: score === null ? null : Math.min(100, Math.round(score * 10)),
    evidenceStatus: severity ? `Classified ${severity}` : "Classified",
    pipelineVerified: verified,
    pipelineSuspicious: severity === "high" || (score !== null && score >= 6),
    reach: num(row.reach),
    detectedAt: row.first_seen_at ?? row.published_at ?? new Date(0).toISOString(),
  };
}

export type FaceMatchRow = {
  id: string;
  source_url: string | null;
  source_type: string | null;
  similarity: number | null;
  threat_category: string | null;
  review_status: string | null;
  created_at: string;
};

export function normalizeFaceMatch(row: FaceMatchRow): RawFinding {
  const status = (row.review_status ?? "").toLowerCase();
  return {
    kind: "face_match",
    id: row.id,
    category: row.threat_category ? String(row.threat_category) : "Likeness match",
    platform: row.source_type ?? platformFromUrl(row.source_url),
    title: null,
    url: row.source_url ?? null,
    thumbnailUrl: null,
    confidence: pct(row.similarity),
    evidenceStatus: status === "confirmed" ? "Analyst confirmed" : "Awaiting review",
    // A similarity match alone is never a verified threat: only an analyst
    // decision recorded by the existing review workflow promotes it.
    pipelineVerified: status === "confirmed",
    pipelineSuspicious: false,
    reach: null,
    detectedAt: row.created_at,
  };
}

export type DeepfakeRow = {
  id: string;
  url: string;
  canonical_url: string | null;
  page_title: string | null;
  source_host: string | null;
  confidence: number | null;
  risk_level: string | null;
  finding_classification: string | null;
  content_category: string | null;
  review_status: string | null;
  created_at: string;
};

export function normalizeDeepfake(row: DeepfakeRow): RawFinding {
  const risk = (row.risk_level ?? "").toLowerCase();
  const cls = (row.finding_classification ?? "").toLowerCase();
  const confidence = pct(row.confidence);
  return {
    kind: "deepfake",
    id: row.id,
    category: row.content_category
      ? `Deepfake · ${row.content_category}`
      : "Deepfake / synthetic media",
    platform: row.source_host ?? platformFromUrl(row.canonical_url ?? row.url),
    title: row.page_title ?? null,
    url: row.canonical_url ?? row.url,
    thumbnailUrl: null,
    confidence,
    evidenceStatus: row.finding_classification ?? row.review_status ?? "Pending classification",
    pipelineVerified:
      cls.includes("verified") || risk === "critical" || (risk === "high" && (confidence ?? 0) >= 85),
    pipelineSuspicious: risk === "high" || risk === "medium",
    reach: null,
    detectedAt: row.created_at,
  };
}

export type ImpersonationRow = {
  id: string;
  platform: string | null;
  handle: string | null;
  display_name: string | null;
  profile_url: string;
  profile_image_url: string | null;
  follower_count: number | null;
  confidence: number | null;
  status: string | null;
  created_at: string;
};

export function normalizeImpersonation(row: ImpersonationRow): RawFinding {
  const status = (row.status ?? "").toLowerCase();
  return {
    kind: "impersonation",
    id: row.id,
    category: "Impersonation account",
    platform: row.platform ?? platformFromUrl(row.profile_url),
    title: row.handle ? `@${row.handle.replace(/^@/, "")}` : row.display_name,
    url: row.profile_url,
    thumbnailUrl: row.profile_image_url ?? null,
    confidence: pct(row.confidence),
    evidenceStatus: status ? status.replace(/_/g, " ") : "discovered",
    pipelineVerified: status === "verified",
    pipelineSuspicious: status === "ownership_pending" || status === "discovered",
    reach: num(row.follower_count),
    detectedAt: row.created_at,
  };
}

export type CopyrightRow = {
  id: string;
  source_url: string;
  page_title: string | null;
  platform: string | null;
  thumbnail_url: string | null;
  confidence: number | null;
  confidence_band: string | null;
  detection_type: string | null;
  review_status: string | null;
  created_at: string;
};

export function normalizeCopyright(row: CopyrightRow): RawFinding {
  const band = (row.confidence_band ?? "").toLowerCase();
  const confidence = pct(row.confidence);
  return {
    kind: "copyright",
    id: row.id,
    category: row.detection_type ? `Copyright · ${row.detection_type}` : "Copyright misuse",
    platform: row.platform ?? platformFromUrl(row.source_url),
    title: row.page_title ?? null,
    url: row.source_url,
    thumbnailUrl: row.thumbnail_url ?? null,
    confidence,
    evidenceStatus: row.confidence_band ?? row.review_status ?? "Pending review",
    pipelineVerified: band === "exact" || (confidence ?? 0) >= 90,
    pipelineSuspicious: band === "probable" || (confidence ?? 0) >= 70,
    reach: null,
    detectedAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic node placement                                        */
/* ------------------------------------------------------------------ */

function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable polar placement so a finding never "moves" between renders. */
export function placeNode(kind: FindingKind, id: string): { angle: number; radius: number } {
  const h = hash32(`${kind}:${id}`);
  return {
    angle: h % 360,
    // Higher radius = further out; kept inside 20–46% of the dish.
    radius: 20 + ((h >>> 9) % 260) / 10,
  };
}

/* ------------------------------------------------------------------ */
/* Campaign association                                                */
/* ------------------------------------------------------------------ */

function normalizeUrl(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#]+$/, "");
}

function normalizeAccount(value: string | null | undefined): string {
  if (!value) return "";
  const v = value.trim().toLowerCase();
  if (/^https?:\/\//.test(v) || v.includes("/")) {
    const parts = normalizeUrl(v).split("/");
    return (parts[parts.length - 1] ?? "").replace(/^@/, "");
  }
  return v.replace(/^@/, "");
}

function withinWindow(campaign: CampaignContext, at: Date): boolean {
  const start = campaign.starts_at ? Date.parse(campaign.starts_at) : null;
  const end = campaign.ends_at ? Date.parse(campaign.ends_at) : null;
  const t = at.getTime();
  if (start !== null && Number.isFinite(start) && t < start) return false;
  if (end !== null && Number.isFinite(end) && t > end) return false;
  return true;
}

const AD_LIKE = /advert|ad ?use|endorse|sponsor|promo|banner|campaign/i;

function matchesCampaignSurface(finding: RawFinding, campaign: CampaignContext): boolean {
  const url = normalizeUrl(finding.url);
  const approvedUrls = [...campaign.official_urls, ...campaign.approved_media_urls].map(
    normalizeUrl,
  );
  if (url && approvedUrls.some((a) => a && (a === url || url.startsWith(`${a}/`)))) return true;
  const account = normalizeAccount(finding.url) || normalizeAccount(finding.title);
  if (account && campaign.approved_accounts.map(normalizeAccount).some((a) => a && a === account))
    return true;
  return false;
}

function mentionsCampaign(finding: RawFinding, campaign: CampaignContext): boolean {
  const haystack = `${finding.title ?? ""} ${finding.category} ${finding.url ?? ""}`.toLowerCase();
  if (campaign.name.length >= 3 && haystack.includes(campaign.name.toLowerCase())) return true;
  return campaign.hashtags.some((h) => {
    const tag = h.replace(/^#/, "").toLowerCase();
    return tag.length >= 3 && haystack.includes(tag);
  });
}

export type AssociationResult = {
  association: Association;
  campaignId: string | null;
  campaignName: string | null;
};

/**
 * Derives interpretation only. The underlying finding row is untouched:
 * an AUTHORIZED association still returns the finding to the caller.
 */
export function associateFinding(
  finding: RawFinding,
  campaigns: CampaignContext[],
  now: Date = new Date(),
  override?: { campaign_id: string | null; association: Association } | null,
): AssociationResult {
  if (override) {
    const c = campaigns.find((x) => x.id === override.campaign_id) ?? null;
    return {
      association: override.association,
      campaignId: override.campaign_id,
      campaignName: c?.name ?? null,
    };
  }

  const surfaceMatch = campaigns.find((c) => matchesCampaignSurface(finding, c));
  if (surfaceMatch) {
    if (surfaceMatch.status === "ACTIVE" && withinWindow(surfaceMatch, now)) {
      return {
        association: "AUTHORIZED",
        campaignId: surfaceMatch.id,
        campaignName: surfaceMatch.name,
      };
    }
    // Authorization window closed — known surface, but usage is no longer
    // covered. Flag for review only; never assert infringement here.
    return {
      association: "POSSIBLE_UNAUTHORIZED_AD",
      campaignId: surfaceMatch.id,
      campaignName: surfaceMatch.name,
    };
  }

  const mentioned = campaigns.find((c) => mentionsCampaign(finding, c));
  if (mentioned) {
    const expired = mentioned.status !== "ACTIVE" || !withinWindow(mentioned, now);
    const adLike = AD_LIKE.test(`${finding.category} ${finding.title ?? ""}`);
    if (expired && adLike) {
      return {
        association: "POSSIBLE_UNAUTHORIZED_AD",
        campaignId: mentioned.id,
        campaignName: mentioned.name,
      };
    }
    if (finding.pipelineVerified || finding.pipelineSuspicious) {
      return { association: "MISUSE", campaignId: mentioned.id, campaignName: mentioned.name };
    }
    return { association: "REVIEW", campaignId: mentioned.id, campaignName: mentioned.name };
  }

  return { association: "REVIEW", campaignId: null, campaignName: null };
}

/* ------------------------------------------------------------------ */
/* Colour mapping                                                      */
/* ------------------------------------------------------------------ */

export function colorFor(finding: RawFinding, association: Association): RadarColor {
  if (association === "AUTHORIZED") return "green";
  // Red requires the existing pipeline's verified / high-confidence verdict.
  if (finding.pipelineVerified) return "red";
  if (association === "MISUSE" || association === "POSSIBLE_UNAUTHORIZED_AD") return "orange";
  if (finding.pipelineSuspicious) return "orange";
  return "yellow";
}

export function deepLinkFor(kind: FindingKind, id: string): string {
  switch (kind) {
    case "reputation":
      return `/scan?hit=${id}`;
    case "face_match":
      return `/face-protection?match=${id}`;
    case "deepfake":
      return `/deepfake-intel?finding=${id}`;
    case "impersonation":
      return `/face-protection?account=${id}`;
    case "copyright":
      return `/copyright-intel?match=${id}`;
  }
}

export function buildRadarFinding(
  raw: RawFinding,
  campaigns: CampaignContext[],
  now: Date = new Date(),
  override?: { campaign_id: string | null; association: Association } | null,
): RadarFinding {
  const assoc = associateFinding(raw, campaigns, now, override);
  const { angle, radius } = placeNode(raw.kind, raw.id);
  return {
    ...raw,
    association: assoc.association,
    campaignId: assoc.campaignId,
    campaignName: assoc.campaignName,
    color: colorFor(raw, assoc.association),
    angle,
    radius,
    deepLink: deepLinkFor(raw.kind, raw.id),
  };
}

export type RadarCounters = {
  protectedFaces: number;
  reputationFindings: number;
  faceMatches: number;
  deepfakeAlerts: number;
  impersonation: number;
  fakeEndorsements: number;
  campaignMisuse: number;
  copyrightFindings: number;
  evidenceItems: number;
};

export function countFindings(
  findings: RadarFinding[],
  extras: { protectedFaces: number; evidenceItems: number },
): RadarCounters {
  const by = (kind: FindingKind) => findings.filter((f) => f.kind === kind).length;
  return {
    protectedFaces: extras.protectedFaces,
    reputationFindings: by("reputation"),
    faceMatches: by("face_match"),
    deepfakeAlerts: by("deepfake"),
    impersonation: by("impersonation"),
    fakeEndorsements: findings.filter((f) => /endorse|sponsor/i.test(f.category)).length,
    campaignMisuse: findings.filter(
      (f) => f.association === "MISUSE" || f.association === "POSSIBLE_UNAUTHORIZED_AD",
    ).length,
    copyrightFindings: by("copyright"),
    evidenceItems: extras.evidenceItems,
  };
}

/** Fields that must never appear in a radar payload. */
export const FORBIDDEN_PAYLOAD_KEYS = [
  "face_id",
  "faceId",
  "collection_id",
  "collectionId",
  "s3_key",
  "s3Key",
  "s3_bucket",
  "image_s3_key",
  "matched_face_id",
  "embedding",
  "vector",
  "bounding_box",
] as const;

export function containsBiometricIdentifiers(payload: unknown): boolean {
  const json = JSON.stringify(payload ?? {});
  return FORBIDDEN_PAYLOAD_KEYS.some((k) => json.includes(`"${k}"`));
}
