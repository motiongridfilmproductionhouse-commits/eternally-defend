import type { ScanHit, Severity } from "@/routes/api/scan";

export type CanonicalThreatCategory =
  | "defamation"
  | "deepfake"
  | "copyright_infringement"
  | "impersonation"
  | "scam_or_fraud"
  | "harassment_or_abuse"
  | "negative_media"
  | "privacy_or_leak"
  | "misinformation"
  | "neutral_mention"
  | "official_content"
  | "unrelated";

/**
 * Classifies a ScanHit into one of 12 canonical threat categories.
 */
export function canonicalCategoryFor(hit: ScanHit): CanonicalThreatCategory {
  const title = (hit.title || "").toLowerCase();
  const desc = (hit.description || "").toLowerCase();
  const url = (hit.url || "").toLowerCase();
  const cat = (hit.category || "").toLowerCase();
  const label = (hit.contentLabel || "").toLowerCase();
  const text = `${title} ${desc} ${url} ${cat} ${label}`;

  // 1. Official content detection
  if (
    /(official (music video|video|audio|trailer|teaser|channel|upload|single|track|movie|release)|vevo|official audio|full song|single launch|official channel|official page)/i.test(
      text,
    ) ||
    hit.source?.toLowerCase().includes("vevo") ||
    (hit.author &&
      /official|vevo|records|label|studios|entertainment|pictures|films|music/i.test(hit.author))
  ) {
    return "official_content";
  }

  // 2. Fan edit / Fan creations
  if (/(fan edit|fanmade|fan creation|tribute video|fan tribute|fan edit video)/i.test(text)) {
    return "neutral_mention";
  }

  // 3. Defamation & character assassination
  if (
    cat.includes("defamation") ||
    label.includes("defamation") ||
    /(false allegation|fake news|character assassination|criminal accusation|rumour|rumor|scandal allegation|affair leak|extramarital|affair scandal)/i.test(
      text,
    )
  ) {
    return "defamation";
  }

  // 4. Deepfakes & synthetic media
  if (
    cat.includes("deepfake") ||
    label.includes("manipulated media") ||
    /(deepfake|ai generated|face swap|fake video|fake image|synthetic voice|ai nude|voice clone)/i.test(
      text,
    )
  ) {
    return "deepfake";
  }

  // 5. Copyright threats, leaks, piracy
  if (
    cat.includes("copyright") ||
    label.includes("copyright") ||
    /(movie leak|unauthorized stream|full movie download|telegram link|terabox|archive\.org|ogomovies|movierulz|tamilrockers|piracy|leaked footage)/i.test(
      text,
    )
  ) {
    return "copyright_infringement";
  }

  // 6. Impersonation
  if (
    cat.includes("impersonation") ||
    label.includes("impersonation") ||
    /(fake account|fake page|fake profile|identity theft|fake twitter|fake instagram)/i.test(text)
  ) {
    return "impersonation";
  }

  // 7. Scam & fraud
  if (
    cat.includes("fake endorsement") ||
    label.includes("scam") ||
    label.includes("fake endorsement") ||
    /(fake giveaway|investment scam|crypto scam|fake endorsement|fraudulent|ticket scam)/i.test(
      text,
    )
  ) {
    return "scam_or_fraud";
  }

  // 8. Harassment & abuse
  if (
    cat.includes("harassment") ||
    label.includes("harassment") ||
    /(targeted abuse|cyberbullying|hate speech|coordinated trolling|death threat|doxxed)/i.test(
      text,
    )
  ) {
    return "harassment_or_abuse";
  }

  // 9. Privacy leak
  if (
    cat.includes("leak") ||
    label.includes("leak") ||
    /(private leak|leaked document|personal phone number|address leak|confidential leak)/i.test(
      text,
    )
  ) {
    return "privacy_or_leak";
  }

  // 10. Misinformation
  if (
    label.includes("misinformation") ||
    label.includes("unverified claim") ||
    label.includes("misleading")
  ) {
    return "misinformation";
  }

  // 11. Negative media & controversy
  if (
    cat.includes("exposé") ||
    cat.includes("controversy") ||
    cat.includes("criticism") ||
    cat.includes("boycott") ||
    cat.includes("complaint") ||
    label.includes("negative review") ||
    label.includes("exposé") ||
    hit.sentiment === "Negative"
  ) {
    return "negative_media";
  }

  // 12. Neutral mention
  if (hit.sentiment === "Neutral" || hit.sentiment === "Positive") {
    return "neutral_mention";
  }

  return "unrelated";
}

/**
 * Returns true if a hit is harmless, official, low-risk, or has insufficient evidence.
 */
export function isHarmlessOrOfficial(hit: ScanHit): boolean {
  const cat = canonicalCategoryFor(hit);
  if (cat === "official_content" || cat === "neutral_mention" || cat === "unrelated") return true;
  if (hit.severity === "Low" && hit.sentiment !== "Negative") return true;
  if (hit.contentLabel === "Insufficient evidence") return true;
  return false;
}

/**
 * Computes a deterministic threat ranking score for a hit.
 */
export function calculateThreatRankingScore(hit: ScanHit): number {
  let score = 0;

  // 1. Severity base
  if (hit.severity === "Critical") score += 1000;
  else if (hit.severity === "High") score += 750;
  else if (hit.severity === "Medium") score += 500;
  else if (hit.severity === "Low") score += 100;

  // 2. Canonical Category Bonus
  const cat = canonicalCategoryFor(hit);
  const categoryBonus: Record<CanonicalThreatCategory, number> = {
    defamation: 300,
    deepfake: 280,
    copyright_infringement: 260,
    impersonation: 240,
    scam_or_fraud: 230,
    harassment_or_abuse: 210,
    privacy_or_leak: 200,
    misinformation: 150,
    negative_media: 100,
    neutral_mention: -300,
    official_content: -500,
    unrelated: -1000,
  };
  score += categoryBonus[cat] ?? 0;

  // 3. Evidence status
  if (hit.confidence >= 85 || hit.contentLabel === "Verified fact") {
    score += 180;
  } else if (hit.confidence >= 50 || hit.contentLabel === "Needs human review") {
    score += 100;
  } else if (hit.contentLabel === "Insufficient evidence" || hit.confidence < 50) {
    score -= 250;
  }

  // 4. Virality & Reach
  score += Math.min(150, Math.round((hit.viralityScore ?? 0) * 1.5));
  score += Math.min(100, Math.round(Math.log10((hit.reachEstimate ?? 0) + 1) * 20));

  // 5. Published within 24 hours
  if (
    hit.freshnessWindow === "24h" ||
    (hit.published && Date.now() - new Date(hit.published).getTime() < 86400000)
  ) {
    score += 75;
  }

  // 6. Cross-platform duplication / repeated detection
  if (
    (hit.engagement ?? 0) > 1000 ||
    (hit.metricsAvailable?.views && hit.media?.views && hit.media.views > 50000)
  ) {
    score += 75;
  }

  // 7. Penalties for fan edits / low-risk entertainment content
  const title = (hit.title || "").toLowerCase();
  if (/(fan edit|fanmade|tribute)/i.test(title)) {
    score -= 300;
  }

  return score;
}

/**
 * Sorts hits deterministically by threat ranking score descending.
 */
export function sortScanHitsByThreat(hits: ScanHit[]): ScanHit[] {
  return [...hits].sort((a, b) => {
    const scoreA = calculateThreatRankingScore(a);
    const scoreB = calculateThreatRankingScore(b);
    if (scoreB !== scoreA) return scoreB - scoreA;

    // Tie-breaker: recency
    const dateA = a.published ? new Date(a.published).getTime() : 0;
    const dateB = b.published ? new Date(b.published).getTime() : 0;
    return dateB - dateA;
  });
}

/**
 * Formats a clean "Why this is dangerous" explanation for a finding card.
 */
export function generateThreatExplanation(hit: ScanHit): {
  reason: string;
  points: string[];
  impact: string;
} {
  const cat = canonicalCategoryFor(hit);
  const points: string[] = [];

  if (cat === "defamation") {
    points.push("Contains unverified false allegations or character damage");
  } else if (cat === "deepfake") {
    points.push("Identified synthetic AI face swap or voice manipulation");
  } else if (cat === "copyright_infringement") {
    points.push("Unauthorized distribution link or leaked media asset");
  } else if (cat === "impersonation") {
    points.push("Unauthorized profile using identity for public engagement");
  } else if (cat === "scam_or_fraud") {
    points.push("Fraudulent endorsement or unauthorized giveaway scam");
  } else if (cat === "harassment_or_abuse") {
    points.push("Coordinated harassment or targeted abusive messaging");
  } else {
    points.push(hit.detectionReason || "Flagged by risk engine for potential reputation harm");
  }

  if (hit.reachEstimate > 50000 || (hit.media?.views && hit.media.views > 50000)) {
    const views = hit.media?.views || hit.reachEstimate;
    points.push(`High audience reach (~${views.toLocaleString()} impressions/views)`);
  }

  if (hit.source) {
    points.push(`Indexed public post on ${hit.source}`);
  }

  if (hit.freshnessWindow === "24h") {
    points.push("Published within the last 24 hours (active viral window)");
  }

  const impactMap: Record<CanonicalThreatCategory, string> = {
    defamation: "High risk of personal & professional reputation damage",
    deepfake: "Severe risk of identity exploitation and public misattribution",
    copyright_infringement: "Direct commercial loss and illegal distribution",
    impersonation: "High risk of public deception and audience fraud",
    scam_or_fraud: "Risk of victim financial loss under subject identity",
    harassment_or_abuse: "Active harassment causing emotional and public stress",
    negative_media: "Moderate risk of negative public perception bias",
    privacy_or_leak: "Critical breach of personal privacy and confidential data",
    misinformation: "Risk of public rumor propagation and false claims",
    neutral_mention: "Low risk — standard public mention",
    official_content: "No risk — official authorized content",
    unrelated: "No risk — unrelated mention",
  };

  return {
    reason: hit.detectionReason || points[0],
    points,
    impact: impactMap[cat] || "Potential reputation impact",
  };
}
