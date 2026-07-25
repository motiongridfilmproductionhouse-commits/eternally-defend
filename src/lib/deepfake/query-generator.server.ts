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
    "deep fake",
    "AI generated",
    "AI image",
    "AI video",
    "face swap",
    "faceswap",
    "synthetic media",
    "fake video",
    "fake photo",
    "morphed image",
    "morphed video",
    "edited explicit image",
    "fake intimate image",
    "non consensual intimate image",
    "NCII",
    "fake nude",
    "AI nude",
    "deepfake nude",
    "explicit deepfake",
    "leaked video fake",
    "viral fake video",
    "fabricated intimate video",
  ];

  const mediaPhrases = [
    "image",
    "photo",
    "video",
    "gallery",
    "watch",
    "clip",
  ];

  const queries: string[] = [];

  for (const identity of identities) {
    const person = quote(identity);

    for (const phrase of riskPhrases) {
      queries.push(`${person} "${phrase}"`);
    }

    for (const risk of [
      "deepfake",
      "face swap",
      "AI nude",
      "fake nude",
      "explicit deepfake",
    ]) {
      for (const media of mediaPhrases) {
        queries.push(`${person} "${risk}" ${media}`);
      }
    }

    // Search indexed image/video pages while suppressing ordinary profiles.
    queries.push(
      `${person} deepfake -site:instagram.com -site:facebook.com`,
      `${person} "AI nude" -site:instagram.com -site:facebook.com`,
      `${person} "fake intimate image" -site:instagram.com -site:facebook.com`,
      `${person} "morphed video" -site:instagram.com -site:facebook.com`,
      `${person} "face swap video" -site:instagram.com -site:facebook.com`,
    );
  }

  return unique(queries).slice(0, 80);
}
