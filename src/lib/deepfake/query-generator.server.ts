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
): string[] {
  const identities = unique([
    target.name,
    ...(target.aliases ?? []),
    ...(target.handles ?? []).map((handle) =>
      handle.replace(/^@/, ""),
    ),
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
    );
  }

  return unique(queries).slice(0, 80);
}
