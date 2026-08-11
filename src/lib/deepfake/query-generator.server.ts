import { generateHighRiskSiteQueries } from "./high-risk-registry.server";

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
    ...(target.handles ?? [])
      .map((h) => h.replace(/^@/, "").trim())
      .filter((h) => !h.includes("not-used-as-identity")),
  ])
    .map((value) => value.trim())
    .filter(Boolean);

  // Tier 1 — Known High-Risk Domain Queries (site:desifakes.com, site:imgfy.net, etc.)
  const highRiskQueries = generateHighRiskSiteQueries({
    name: target.name,
    aliases: target.aliases,
  });

  // Tier 2 — Threat-Intent Web Queries
  const threatPhrases = [
    "deepfake",
    "deep fake",
    "faceswap",
    "face swap",
    "fake nude",
    "nude fake",
    "ai fake",
    "ai generated",
    "synthetic media",
    "fake video",
    "fake images",
    "explicit ai",
    "leaked ai",
    "face morph",
  ];

  const threatWebQueries: string[] = [];
  for (const identity of identities) {
    const person = quote(identity);
    for (const phrase of threatPhrases) {
      threatWebQueries.push(`${person} ${phrase}`);
    }
  }

  // Tier 3 — Indexed Social / Platform Discovery
  const socialQueries: string[] = [];
  for (const identity of identities) {
    const person = quote(identity);
    socialQueries.push(
      `${person} deepfake site:reddit.com`,
      `${person} face swap site:reddit.com`,
      `${person} ai nude site:t.me`,
      `${person} deepfake site:t.me`,
      `${person} fake video site:x.com`,
      `${person} synthetic media site:terabox.com`,
    );
  }

  // Bounded focused budget: 64 queries max (40% High-Risk Domains, 40% Open-Web Threat, 20% Social/Indexed)
  const maxTotal = 64;
  const highRiskTargetCount = 28;
  const openWebTargetCount = 26;
  const socialTargetCount = 10;

  const slicedHighRisk = unique(highRiskQueries).slice(0, highRiskTargetCount);
  const slicedOpenWeb = unique(threatWebQueries).slice(0, openWebTargetCount);
  const slicedSocial = unique(socialQueries).slice(0, socialTargetCount);

  const combined = unique([...slicedHighRisk, ...slicedOpenWeb, ...slicedSocial]);

  return combined.slice(0, maxTotal);
}
