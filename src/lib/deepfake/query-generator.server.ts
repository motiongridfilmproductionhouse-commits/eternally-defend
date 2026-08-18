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

  // Tier 3 — Distribution / Mirror Host Discovery.
  // NOTE: reddit.com and x.com/twitter.com are intentionally NOT queried here.
  // Both are on the platform blocklist (see isBlockedHost in ./queries) and any
  // hit on those hosts is dropped before verification — querying them only
  // burns query budget for zero possible findings. Target hosts that are
  // actually reachable and already recognised as high-risk synthetic-media
  // distribution points downstream (see HIGH_RISK_SYNTHETIC_HOSTS in
  // ./filter.server).
  const distributionQueries: string[] = [];
  for (const identity of identities) {
    const person = quote(identity);
    distributionQueries.push(
      `${person} ai nude site:t.me`,
      `${person} deepfake site:t.me`,
      `${person} synthetic media site:terabox.com`,
      `${person} deepfake site:mega.nz`,
      `${person} leaked site:coomer.su`,
      `${person} leaked site:kemono.su`,
      `${person} fake nude site:cyberdrop.me`,
      `${person} deepfake site:pixeldrain.com`,
    );
  }

  // Tier 4 — Impersonation & Repost/Mirror-Context Discovery.
  // Distinct from Tier 2's manipulation-keyword search: these target pages that
  // describe *distribution* (a repost, a mirror, an impersonating account)
  // rather than the media itself, which surfaces forum/aggregator pages that
  // link onward to the actual hosted content.
  const impersonationMirrorQueries: string[] = [];
  for (const identity of identities) {
    const person = quote(identity);
    impersonationMirrorQueries.push(
      `${person} impersonating deepfake`,
      `${person} fake account deepfake`,
      `${person} deepfake reupload`,
      `${person} deepfake mirror link`,
      `${person} fake nude backup link`,
      `${person} catfish deepfake`,
    );
  }

  // Bounded focused budget: ~68 queries max, split across four families so no
  // single tier can starve the others. Query text is a discovery lead only —
  // matching a keyword is never treated as proof of a threat.
  const maxTotal = 68;
  const highRiskTargetCount = 28;
  const openWebTargetCount = 24;
  const distributionTargetCount = 10;
  const impersonationMirrorTargetCount = 6;

  const slicedHighRisk = unique(highRiskQueries).slice(0, highRiskTargetCount);
  const slicedOpenWeb = unique(threatWebQueries).slice(0, openWebTargetCount);
  const slicedDistribution = unique(distributionQueries).slice(0, distributionTargetCount);
  const slicedImpersonationMirror = unique(impersonationMirrorQueries).slice(
    0,
    impersonationMirrorTargetCount,
  );

  const combined = unique([
    ...slicedHighRisk,
    ...slicedOpenWeb,
    ...slicedDistribution,
    ...slicedImpersonationMirror,
  ]);

  return combined.slice(0, maxTotal);
}
