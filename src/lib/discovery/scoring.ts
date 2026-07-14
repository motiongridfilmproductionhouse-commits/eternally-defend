// Pure, client-safe scoring utilities for social-account discovery.
// No runtime dependencies — safe to import from server functions and UI.

export type Platform =
  | "youtube" | "instagram" | "facebook" | "tiktok"
  | "x" | "linkedin" | "reddit" | "website";

export interface Signals {
  nameSim?: number;    // 0..1
  handleSim?: number;  // 0..1
  domainMatch?: boolean;
  inboundFromSite?: boolean;
  crossLinked?: boolean;
  platformVerified?: boolean;
  countryOrgMatch?: boolean;
}

export interface ScoreResult {
  confidence: number;      // 0..100
  reasons: string[];
  signals: Signals & {
    weights: Record<keyof Signals, number>;
  };
}

const WEIGHTS = {
  nameSim: 25,
  handleSim: 15,
  domainMatch: 20,
  inboundFromSite: 20,
  crossLinked: 10,
  platformVerified: 5,
  countryOrgMatch: 5,
} as const;

/** Case/space-insensitive normalization. */
export function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Jaro-Winkler similarity (0..1). Good for names/handles. */
export function jaroWinkler(a: string, b: string): number {
  const s1 = normalize(a);
  const s2 = normalize(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const m = Math.max(s1.length, s2.length);
  const matchWindow = Math.max(0, Math.floor(m / 2) - 1);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t = t / 2;
  const jaro = (matches / s1.length + matches / s2.length + (matches - t) / matches) / 3;

  // Winkler prefix bonus (up to 4 chars)
  let l = 0;
  while (l < Math.min(4, s1.length, s2.length) && s1[l] === s2[l]) l++;
  return jaro + l * 0.1 * (1 - jaro);
}

/** Extract hostname from a URL string (returns "" on failure). */
export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

/** True when `haystack` (bio/blob) mentions the target domain. */
export function mentionsDomain(haystack: string | null | undefined, domain: string | null | undefined): boolean {
  if (!haystack || !domain) return false;
  return haystack.toLowerCase().includes(domain.toLowerCase());
}

export function scoreCandidate(input: {
  subjectName: string;
  subjectDomain?: string | null;
  candidateName?: string | null;
  candidateHandle?: string | null;
  candidateBio?: string | null;
  candidateWebsiteLinks?: string[];
  inboundFromSiteHosts?: string[];         // hosts the user's official site links out to
  candidateProfileUrl: string;
  crossLinked?: boolean;
  platformVerified?: boolean;
  countryOrgMatch?: boolean;
}): ScoreResult {
  const nameSim = jaroWinkler(input.subjectName, input.candidateName ?? "");
  const handleSim = jaroWinkler(input.subjectName, input.candidateHandle ?? "");

  const candidateHosts = (input.candidateWebsiteLinks ?? []).map(hostOf).filter(Boolean);
  const domainMatch =
    !!input.subjectDomain &&
    (candidateHosts.includes(input.subjectDomain.toLowerCase()) ||
      mentionsDomain(input.candidateBio, input.subjectDomain));

  const profileHost = hostOf(input.candidateProfileUrl);
  const inboundFromSite = !!(input.inboundFromSiteHosts?.includes(profileHost)) ||
    (!!input.candidateHandle && !!input.inboundFromSiteHosts?.some((h) => h.endsWith(input.candidateHandle!.toLowerCase())));

  const reasons: string[] = [];
  if (nameSim >= 0.85) reasons.push(`Name matches (${Math.round(nameSim * 100)}%)`);
  else if (nameSim >= 0.7) reasons.push(`Name is similar (${Math.round(nameSim * 100)}%)`);
  if (handleSim >= 0.8) reasons.push(`Handle matches (${Math.round(handleSim * 100)}%)`);
  if (domainMatch) reasons.push(`Links to ${input.subjectDomain}`);
  if (inboundFromSite) reasons.push("Linked from your official website");
  if (input.crossLinked) reasons.push("Cross-linked from another candidate");
  if (input.platformVerified) reasons.push("Platform-verified badge");
  if (input.countryOrgMatch) reasons.push("Country/organisation match");

  let confidence =
    WEIGHTS.nameSim * nameSim +
    WEIGHTS.handleSim * handleSim +
    (domainMatch ? WEIGHTS.domainMatch : 0) +
    (inboundFromSite ? WEIGHTS.inboundFromSite : 0) +
    (input.crossLinked ? WEIGHTS.crossLinked : 0) +
    (input.platformVerified ? WEIGHTS.platformVerified : 0) +
    (input.countryOrgMatch ? WEIGHTS.countryOrgMatch : 0);
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return {
    confidence,
    reasons,
    signals: {
      nameSim, handleSim, domainMatch, inboundFromSite,
      crossLinked: !!input.crossLinked,
      platformVerified: !!input.platformVerified,
      countryOrgMatch: !!input.countryOrgMatch,
      weights: WEIGHTS,
    },
  };
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  website: "Website",
};

export const PLATFORM_HOST: Record<Platform, string> = {
  youtube: "youtube.com",
  instagram: "instagram.com",
  facebook: "facebook.com",
  tiktok: "tiktok.com",
  x: "x.com",
  linkedin: "linkedin.com",
  reddit: "reddit.com",
  website: "",
};

export function platformOfUrl(url: string): Platform | null {
  const h = hostOf(url);
  if (!h) return null;
  if (h.endsWith("youtube.com") || h.endsWith("youtu.be")) return "youtube";
  if (h.endsWith("instagram.com")) return "instagram";
  if (h.endsWith("facebook.com") || h.endsWith("fb.com")) return "facebook";
  if (h.endsWith("tiktok.com")) return "tiktok";
  if (h.endsWith("x.com") || h.endsWith("twitter.com")) return "x";
  if (h.endsWith("linkedin.com")) return "linkedin";
  if (h.endsWith("reddit.com")) return "reddit";
  return null;
}

/** Best-effort handle extraction from a profile URL. */
export function handleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    // youtube /@name, /c/name, /channel/UC..., /user/name
    if (u.hostname.includes("youtube")) {
      if (parts[0].startsWith("@")) return parts[0];
      if (["c", "user", "channel"].includes(parts[0])) return parts[1] ?? null;
      return null;
    }
    if (u.hostname.includes("linkedin")) {
      // /in/handle, /company/handle
      return parts[1] ?? null;
    }
    if (u.hostname.includes("reddit")) {
      // /r/name or /user/name
      return parts[1] ?? null;
    }
    return parts[0].startsWith("@") ? parts[0].slice(1) : parts[0];
  } catch { return null; }
}
