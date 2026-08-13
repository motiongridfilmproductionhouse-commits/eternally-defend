/**
 * Official company social profiles.
 *
 * Pure helpers only. These links are self-declared by the company: they are
 * stored as OFFICIAL / TRUSTED reference accounts so monitoring and
 * impersonation detection can tell an authentic company account apart from a
 * suspicious look-alike. No OAuth and no ownership proof is performed, so the
 * links are never labelled "verified".
 */

export const COMPANY_SOCIAL_PLATFORMS = [
  "linkedin",
  "instagram",
  "facebook",
  "x",
  "youtube",
  "tiktok",
  "other",
] as const;

export type CompanySocialPlatform = (typeof COMPANY_SOCIAL_PLATFORMS)[number];

export const COMPANY_SOCIAL_LABELS: Record<CompanySocialPlatform, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X / Twitter",
  youtube: "YouTube",
  tiktok: "TikTok",
  other: "Other official profile",
};

export const COMPANY_SOCIAL_PLACEHOLDERS: Record<CompanySocialPlatform, string> = {
  linkedin: "https://linkedin.com/company/your-company",
  instagram: "https://instagram.com/yourcompany",
  facebook: "https://facebook.com/yourcompany",
  x: "https://x.com/yourcompany",
  youtube: "https://youtube.com/@yourcompany",
  tiktok: "https://tiktok.com/@yourcompany",
  other: "https://yourcompany.com/press",
};

export function isCompanySocialPlatform(value: unknown): value is CompanySocialPlatform {
  return (
    typeof value === "string" &&
    (COMPANY_SOCIAL_PLATFORMS as readonly string[]).includes(value)
  );
}

export type CompanyOfficialProfile = {
  platform: CompanySocialPlatform;
  url: string;
  label?: string | null;
};

/** Normalises a profile URL; returns null when it is not a usable http(s) URL. */
export function normalizeProfileUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Cleans a submitted list: drops empty/invalid URLs and de-duplicates by URL,
 * keeping submission order.
 */
export function normalizeOfficialProfiles(
  rows: readonly { platform: string; url: string; label?: string | null }[],
): CompanyOfficialProfile[] {
  const seen = new Set<string>();
  const out: CompanyOfficialProfile[] = [];
  for (const row of rows) {
    if (!isCompanySocialPlatform(row.platform)) continue;
    const url = normalizeProfileUrl(row.url);
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      platform: row.platform,
      url,
      label: row.label?.trim() ? row.label.trim() : null,
    });
  }
  return out;
}

/** Parses persisted profiles back into the presentation model. */
export function readOfficialProfiles(value: unknown): CompanyOfficialProfile[] {
  if (!Array.isArray(value)) return [];
  return normalizeOfficialProfiles(
    value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        platform: String(item["platform"] ?? ""),
        url: String(item["url"] ?? ""),
        label: typeof item["label"] === "string" ? item["label"] : null,
      })),
  );
}
