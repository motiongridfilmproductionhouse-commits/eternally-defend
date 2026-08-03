export type DeepfakeTarget = {
  name: string;
  aliases?: string[];
  handles?: string[];
};

const quote = (value: string): string =>
  `"${value.replaceAll('"', "").trim()}"`;

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const RISK_PHRASES = [
  "deepfake",
  "AI deepfake",
  "AI face swap",
  "face swap",
  "faceswap",
  "AI edit",
  "AI video",
  "fake video",
  "morph",
  "celebrity swap",
  "nude AI",
  "leaked AI",
  "AI generated",
  "AI-generated",
  "face replacement",
  "adult AI",
  "synthetic video",
  "AI portrait",
  "fake nude",
  "AI nude",
  "nudity",
  "explicit image",
  "explicit video",
  "NSFW",
  "leaked photo",
  "leaked video",
  "porn",
  "synthetic media",
  "morphed",
  "morphed video",
  "morphed photo",
  "fake leak",
  "fake leaked",
  "deepfake porn",
  "AI porn",
  "fake OnlyFans",
  "Telegram leak",
  "Discord leak",
  "imageboard",
  "gallery",
  "images",
  "video",
  "clip",
  "download",
  "mirror",
  "repost",
  "impersonation",
];

const SITE_EXCLUSIONS =
  "-site:youtube.com -site:youtu.be -site:vimeo.com -site:tiktok.com -site:instagram.com -site:facebook.com -site:linkedin.com -site:x.com -site:twitter.com";

export function generateDeepfakeQueries(
  target: DeepfakeTarget,
  options?: { maxQueries?: number; minQueries?: number },
): string[] {
  const minQueries = Math.max(1, options?.minQueries ?? 40);
  const maxQueries = Math.min(
    84,
    Math.max(minQueries, options?.maxQueries ?? 72),
  );

  const identities = unique([
    target.name,
    ...(target.aliases ?? []),
    ...(target.handles ?? []).map((h) => h.replace(/^@+/, "")),
  ])
    .map((value) => value.trim())
    .filter(Boolean);

  const queries: string[] = [];

  for (const identity of identities) {
    const person = quote(identity);

    for (const phrase of RISK_PHRASES) {
      queries.push(`${person} "${phrase}" ${SITE_EXCLUSIONS}`);
    }

    queries.push(
      `${person} (deepfake OR "face swap" OR "AI nude") (gallery OR images OR video) ${SITE_EXCLUSIONS}`,
      `${person} (nude OR porn OR NSFW OR explicit) (deepfake OR AI OR fake OR synthetic) ${SITE_EXCLUSIONS}`,
      `${person} ("deepfake porn" OR "fake nude" OR "AI nude")`,
      `${person} ("morphed" OR "faceswap" OR "face swap") (photo OR video OR clip)`,
      `${person} ("fake leak" OR "leaked video" OR "leaked photos") (AI OR deepfake OR morphed)`,
      `${person} ("AI generated" OR synthetic OR manipulated) (nude OR explicit OR porn)`,
      `${person} ("deepfake" OR "AI nude") (mirror OR repost OR download)`,
      `${person} ("synthetic video" OR "AI portrait" OR "celebrity swap")`,
    );
  }

  return unique(queries).slice(0, maxQueries);
}
