export type DeepfakeTarget = {
  name: string;
  aliases?: string[];
  handles?: string[];
};

const quote = (value: string): string => `"${value.replaceAll('"', "").trim()}"`;

const unique = <T>(items: T[]): T[] => [...new Set(items)];

export function generateDeepfakeQueries(target: DeepfakeTarget): string[] {
  const identities = unique([
    target.name,
    ...(target.aliases ?? []),
    ...(target.handles ?? []).map((handle) => handle.replace(/^@/, "")),
  ])
    .map((value) => value.trim())
    .filter(Boolean);

  const primaryPhrases = [
    "deepfake",
    "ai generated",
    "face swap",
    "fake video",
    "fake image",
    "synthetic media",
    "ai nude",
    "manipulated",
    "explicit ai",
    "fake instagram",
    "leaked ai",
    "deepfake reddit",
    "deepfake telegram",
    "deepfake twitter",
    "face swap video",
    "voice clone",
    "face morph",
    "fake endorsement",
    "celebrity impersonation",
    "terabox deepfake",
  ];

  const queries: string[] = [];

  for (const identity of identities) {
    const person = quote(identity);
    const unquoted = identity;

    // 1. Direct targeted queries
    for (const phrase of primaryPhrases) {
      queries.push(`${unquoted} ${phrase}`);
    }

    // 2. Specialized platform & archive queries
    queries.push(
      `${person} deepfake site:reddit.com`,
      `${person} face swap site:reddit.com`,
      `${person} ai nude site:t.me`,
      `${person} deepfake site:t.me`,
      `${person} face swap site:terabox.com`,
      `${person} deepfake site:archive.org`,
      `${person} fake video site:x.com`,
      `${person} synthetic media site:pinterest.com`,
      `${person} (deepfake OR "face swap" OR "ai nude") (gallery OR video OR link)`,
      `${person} ("voice clone" OR "fake endorsement" OR "impersonation")`,
    );
  }

  return unique(queries).slice(0, 100);
}
