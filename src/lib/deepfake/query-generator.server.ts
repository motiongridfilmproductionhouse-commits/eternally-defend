export type DeepfakeTarget = {
  name: string;
  aliases?: string[];
  handles?: string[];
};

const quote = (value: string): string =>
  `"${value.replaceAll('"', "").trim()}"`;

const unique = <T>(items: T[]): T[] => [...new Set(items)];

export function generateDeepfakeQueries(
  target: DeepfakeTarget,
  options?: { maxQueries?: number },
): string[] {
  const maxQueries = Math.min(
    60,
    Math.max(40, options?.maxQueries ?? 56),
  );

  const identities = unique([
    target.name,
    ...(target.aliases ?? []),
  ])
    .map((value) => value.trim())
    .filter(Boolean);

  const riskPhrases = [
    "deepfake",
    "AI deepfake",
    "face swap",
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

  const queries: string[] = [];

  for (const identity of identities) {
    const person = quote(identity);

    for (const phrase of riskPhrases) {
      queries.push(
        `${person} "${phrase}" -site:youtube.com -site:youtu.be -site:vimeo.com -site:tiktok.com -site:instagram.com -site:facebook.com -site:linkedin.com -site:x.com -site:twitter.com`,
      );
    }

    // High-signal combinations favour pages hosting or advertising the media,
    // rather than general reporting and social/video platform mentions.
    queries.push(
      `${person} (deepfake OR "face swap" OR "AI nude") (gallery OR images OR video) -site:youtube.com -site:vimeo.com -site:tiktok.com -site:instagram.com -site:facebook.com -site:linkedin.com -site:x.com -site:twitter.com`,
      `${person} (nude OR porn OR NSFW OR explicit) (deepfake OR AI OR fake OR synthetic) -site:youtube.com -site:vimeo.com -site:tiktok.com -site:instagram.com -site:facebook.com -site:linkedin.com -site:x.com -site:twitter.com`,
      `${person} ("deepfake porn" OR "fake nude" OR "AI nude")`,
      `${person} ("morphed" OR "faceswap" OR "face swap") (photo OR video OR clip)`,
      `${person} ("fake leak" OR "leaked video" OR "leaked photos") (AI OR deepfake OR morphed)`,
      `${person} ("AI generated" OR synthetic OR manipulated) (nude OR explicit OR porn)`,
      `${person} ("deepfake" OR "AI nude") (mirror OR repost OR download)`,
    );
  }

  return unique(queries).slice(0, maxQueries);
}
