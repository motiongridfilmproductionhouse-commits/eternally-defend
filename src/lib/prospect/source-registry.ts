/**
 * Pre-Enrollment Intelligence — source-family registry.
 *
 * A "source family" is a class of sources the scan intends to query (Google,
 * general web, YouTube, Instagram, ...). Each family declares whether we can
 * query the platform itself (`directAccess`), which discovery providers back
 * it, whether product policy allows it, and which secrets it needs.
 *
 * Why a registry: enabling a new source later (an approved Reddit integration,
 * an official Meta API) must be a registry + adapter change only — the scan
 * workflow, coverage maths and UI never change shape.
 *
 * Pure and client-safe: no secret values are read here, only names. Runtime
 * availability is resolved server-side in scan-engine.server.ts.
 */

export const SOURCE_FAMILY_SET_VERSION = "v1";

export type SourceFamilyKey =
  | "google_search"
  | "web_general"
  | "news"
  | "youtube"
  | "images"
  | "fact_check"
  | "encyclopaedic"
  | "instagram"
  | "facebook"
  | "x_twitter"
  | "tiktok"
  | "reddit";

export type WeightClass = "major" | "supporting";

export interface SourceFamily {
  key: SourceFamilyKey;
  label: string;
  /** Can we query the platform/source itself (as opposed to finding its URLs via web search)? */
  directAccess: boolean;
  /** Product policy allows this family at all. */
  policyEnabled: boolean;
  /** Why policy disabled it (shown verbatim in the source rail). */
  policyReason?: string;
  /** Discovery providers that serve this family. */
  providers: string[];
  /** Secret names that must be present for the family to be queryable. */
  requiresSecrets: string[];
  /** Any one of these secrets is enough (e.g. YOUTUBE_API_KEY or GOOGLE_API_KEY). */
  requiresAnySecret?: string[];
  weightClass: WeightClass;
  /** Platform hosts attributed to this family when a URL is found via web search. */
  platformHosts?: string[];
  /** Shown when the family cannot be queried directly. */
  unavailableReason?: string;
}

export const SOURCE_FAMILIES: readonly SourceFamily[] = [
  {
    key: "google_search",
    label: "Google",
    directAccess: true,
    policyEnabled: true,
    providers: ["google"],
    requiresSecrets: ["GOOGLE_SEARCH_API_KEY", "GOOGLE_SEARCH_ENGINE_ID"],
    weightClass: "major",
  },
  {
    key: "web_general",
    label: "Web",
    directAccess: true,
    policyEnabled: true,
    providers: ["brave", "firecrawl", "gemini_grounding", "ddg_html"],
    requiresSecrets: [],
    requiresAnySecret: ["BRAVE_API_KEY", "FIRECRAWL_API_KEY", "GEMINI_API_KEY"],
    weightClass: "major",
  },
  {
    key: "news",
    label: "News",
    directAccess: true,
    policyEnabled: true,
    providers: ["brave", "google", "firecrawl"],
    requiresSecrets: [],
    requiresAnySecret: ["BRAVE_API_KEY", "GOOGLE_SEARCH_API_KEY", "FIRECRAWL_API_KEY"],
    weightClass: "supporting",
  },
  {
    key: "youtube",
    label: "YouTube",
    directAccess: true,
    policyEnabled: true,
    providers: ["youtube_data_api"],
    requiresSecrets: [],
    requiresAnySecret: ["YOUTUBE_API_KEY", "GOOGLE_API_KEY"],
    weightClass: "major",
  },
  {
    key: "images",
    label: "Images",
    directAccess: true,
    policyEnabled: true,
    providers: ["brave_images", "google_images"],
    requiresSecrets: [],
    requiresAnySecret: ["BRAVE_API_KEY", "GOOGLE_SEARCH_API_KEY", "FIRECRAWL_API_KEY"],
    weightClass: "supporting",
  },
  {
    key: "fact_check",
    label: "Fact checks",
    directAccess: true,
    policyEnabled: true,
    providers: ["google_fact_check"],
    requiresSecrets: ["FACT_CHECK_API_KEY"],
    weightClass: "supporting",
  },
  {
    key: "encyclopaedic",
    label: "Reference",
    directAccess: true,
    policyEnabled: true,
    providers: ["wikipedia"],
    requiresSecrets: [],
    weightClass: "supporting",
  },
  {
    key: "instagram",
    label: "Instagram",
    directAccess: false,
    policyEnabled: true,
    providers: ["hikerapi"],
    requiresSecrets: ["HIKERAPI_ACCESS_KEY", "HIKERAPI_ENABLED"],
    weightClass: "major",
    platformHosts: ["instagram.com"],
    unavailableReason: "No permitted API access configured",
  },
  {
    key: "facebook",
    label: "Facebook",
    directAccess: false,
    policyEnabled: true,
    providers: [],
    requiresSecrets: ["FACEBOOK_GRAPH_ACCESS_TOKEN"],
    weightClass: "major",
    platformHosts: ["facebook.com", "fb.com", "fb.watch"],
    unavailableReason: "No permitted API access configured",
  },
  {
    key: "x_twitter",
    label: "X",
    directAccess: false,
    policyEnabled: true,
    providers: [],
    requiresSecrets: ["X_API_BEARER_TOKEN"],
    weightClass: "major",
    platformHosts: ["x.com", "twitter.com", "t.co"],
    unavailableReason: "No permitted API access configured",
  },
  {
    key: "tiktok",
    label: "TikTok",
    directAccess: false,
    policyEnabled: true,
    providers: [],
    requiresSecrets: ["TIKTOK_API_ACCESS_TOKEN"],
    weightClass: "major",
    platformHosts: ["tiktok.com"],
    unavailableReason: "No permitted API access configured",
  },
  {
    key: "reddit",
    label: "Reddit",
    directAccess: false,
    // Standing product rule: Reddit is not monitored. Wired but off; enabling
    // it requires an approved integration AND a policy change.
    policyEnabled: false,
    policyReason: "Disabled by product policy for this release",
    providers: [],
    requiresSecrets: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    weightClass: "supporting",
    platformHosts: ["reddit.com", "redd.it"],
    unavailableReason: "Disabled by product policy for this release",
  },
] as const;

export function familyByKey(key: string): SourceFamily | undefined {
  return SOURCE_FAMILIES.find((f) => f.key === key);
}

/** Families the scan intends to attempt (policy-enabled ones). */
export function intendedFamilies(): SourceFamily[] {
  return SOURCE_FAMILIES.filter((f) => f.policyEnabled);
}

export function policyDisabledFamilies(): SourceFamily[] {
  return SOURCE_FAMILIES.filter((f) => !f.policyEnabled);
}

/**
 * Attribute a URL to a platform label for display. Returns null when the URL
 * belongs to no tracked platform (ordinary web result).
 */
export function platformForUrl(url: string): { platform: string; familyKey: SourceFamilyKey } | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  for (const family of SOURCE_FAMILIES) {
    for (const candidate of family.platformHosts ?? []) {
      if (host === candidate || host.endsWith(`.${candidate}`)) {
        return { platform: family.label, familyKey: family.key };
      }
    }
  }
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
    return { platform: "YouTube", familyKey: "youtube" };
  }
  return null;
}
