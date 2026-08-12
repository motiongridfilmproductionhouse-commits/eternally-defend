import type { ScanHit, Severity } from "@/routes/api/scan";
import type { RiskCategory } from "./evidence-classifier";

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

/** Maps an evidence-classifier risk category to a canonical threat category. */
function evidenceRiskToCanonical(category: RiskCategory | undefined): CanonicalThreatCategory {
  switch (category) {
    case "MANIPULATED_MEDIA":
      return "deepfake";
    case "IMPERSONATION":
      return "impersonation";
    case "PRIVACY_RISK":
      return "privacy_or_leak";
    case "HARASSMENT":
      return "harassment_or_abuse";
    case "ALLEGATION":
    case "ACCUSATION":
    case "LEGAL_DISPUTE":
    case "MISLEADING_NARRATIVE":
      return "defamation";
    case "MISINFORMATION":
      return "misinformation";
    case "CONTROVERSY":
    case "CRITICISM":
    default:
      return "negative_media";
  }
}

/**
 * When the evidence-gated classifier already ran for this hit
 * (`classificationTier` present), its verdict is authoritative — keyword
 * matching is a legacy fallback reached only for hits persisted before the
 * evidence gate existed. Source type never enters this decision.
 */
function canonicalCategoryFromEvidence(hit: ScanHit): CanonicalThreatCategory | null {
  if (!hit.classificationTier) return null;
  switch (hit.classificationTier) {
    case "TIER_0_IRRELEVANT":
      return "unrelated";
    case "TIER_1_NEUTRAL":
      return hit.riskClassification === "OFFICIAL_OR_PROMOTIONAL"
        ? "official_content"
        : "neutral_mention";
    case "TIER_2_NEEDS_REVIEW":
    case "TIER_3_REPUTATION_RISK":
    case "TIER_4_HIGH_RISK":
      return evidenceRiskToCanonical(hit.riskEvidence?.riskCategory ?? undefined);
  }
}

/**
 * Classifies a ScanHit into one of 12 canonical threat categories.
 */
export function canonicalCategoryFor(hit: ScanHit): CanonicalThreatCategory {
  const fromEvidence = canonicalCategoryFromEvidence(hit);
  if (fromEvidence) return fromEvidence;

  // Legacy keyword fallback — only reached for hits with no classificationTier
  // (persisted before the evidence-gated classifier existed).
  const title = (hit.title || "").toLowerCase();
  const desc = (hit.description || "").toLowerCase();
  const url = (hit.url || "").toLowerCase();
  const cat = (hit.category || "").toLowerCase();
  const label = (hit.contentLabel || "").toLowerCase();
  const author = (hit.author || "").toLowerCase();
  const text = `${title} ${desc} ${url} ${cat} ${label} ${author}`;

  // 1. Official content detection (YouTube uploads, trailers, OTT clips, music, Vevo, Shorts)
  if (
    /(official (music video|video|audio|trailer|teaser|channel|upload|single|track|movie|release|clip|scene|jukebox|interview|press meet|full movie)|vevo|manoramamax|hotstar|prime video|zee5|sony liv|netflix|youtube\.com\/shorts|#shorts|shorts|lyrical video|jukebox|behind the scenes|making of)/i.test(
      text,
    ) ||
    hit.source?.toLowerCase().includes("vevo") ||
    /official|vevo|records|label|studios|entertainment|pictures|films|music|media|television|broadcasting|channel|productions/i.test(
      author,
    )
  ) {
    return "official_content";
  }

  // 2. Fan edit / Fan creations / Fan tributes
  if (
    /(fan edit|fanmade|fan creation|tribute video|fan tribute|fan edit video|fan compilation)/i.test(
      text,
    )
  ) {
    return "neutral_mention";
  }

  // 3. Defamation & character assassination
  if (
    cat.includes("defamation") ||
    label.includes("defamation") ||
    /(false allegation|fake news|character assassination|criminal accusation|rumour|rumor|scandal allegation|affair leak|extramarital|affair scandal|exposed|allegation)/i.test(
      text,
    )
  ) {
    return "defamation";
  }

  // 4. Deepfakes & synthetic media
  if (
    cat.includes("deepfake") ||
    label.includes("manipulated media") ||
    /(deepfake|ai generated|face swap|fake video|fake image|synthetic voice|ai nude|voice clone|deep fake)/i.test(
      text,
    )
  ) {
    return "deepfake";
  }

  // 5. Copyright threats, leaks, piracy
  if (
    cat.includes("copyright") ||
    label.includes("copyright") ||
    /(movie leak|unauthorized stream|full movie download|telegram link|terabox|archive\.org|ogomovies|movierulz|tamilrockers|1tamilmv|filmyzilla|piracy|leaked footage|full movie watch online)/i.test(
      text,
    )
  ) {
    return "copyright_infringement";
  }

  // 6. Impersonation
  if (
    cat.includes("impersonation") ||
    label.includes("impersonation") ||
    /(fake account|fake page|fake profile|identity theft|fake twitter|fake instagram|fake facebook)/i.test(
      text,
    )
  ) {
    return "impersonation";
  }

  // 7. Scam & fraud
  if (
    cat.includes("fake endorsement") ||
    label.includes("scam") ||
    label.includes("fake endorsement") ||
    /(fake giveaway|investment scam|crypto scam|fake endorsement|fraudulent|ticket scam|fake promotion)/i.test(
      text,
    )
  ) {
    return "scam_or_fraud";
  }

  // 8. Harassment & abuse
  if (
    cat.includes("harassment") ||
    label.includes("harassment") ||
    /(targeted abuse|cyberbullying|hate speech|coordinated trolling|death threat|doxxed|harassment)/i.test(
      text,
    )
  ) {
    return "harassment_or_abuse";
  }

  // 9. Privacy leak
  if (
    cat.includes("leak") ||
    label.includes("leak") ||
    /(private leak|leaked document|personal phone number|address leak|confidential leak|leaked photo)/i.test(
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
  if (hit.contentLabel === "Neutral mention") return true;

  const title = (hit.title || "").toLowerCase();
  if (
    /(fan edit|fanmade|fan creation|tribute video|shorts|#shorts|manoramamax|jukebox|lyrical video|trailer|official song)/i.test(
      title,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Computes a deterministic threat ranking score for a hit.
 * Threats receive positive scores (800 - 3000+).
 * Official content, fan edits, and neutral mentions receive negative scores (-1500 to -3000).
 */
export function calculateThreatRankingScore(hit: ScanHit): number {
  const cat = canonicalCategoryFor(hit);

  // Official content, fan edits, and neutral mentions MUST have negative scores
  if (cat === "official_content") return -2000;
  if (cat === "unrelated") return -3000;
  if (isHarmlessOrOfficial(hit)) return -1500;

  let score = 0;

  // 1. Severity base
  if (hit.severity === "Critical") score += 2000;
  else if (hit.severity === "High") score += 1500;
  else if (hit.severity === "Medium") score += 800;
  else if (hit.severity === "Low") score += 100;

  // 2. Category Priority Bonus
  const categoryBonus: Record<CanonicalThreatCategory, number> = {
    defamation: 500,
    deepfake: 450,
    copyright_infringement: 400,
    impersonation: 350,
    scam_or_fraud: 300,
    harassment_or_abuse: 250,
    privacy_or_leak: 200,
    misinformation: 150,
    negative_media: 100,
    neutral_mention: -1500,
    official_content: -2000,
    unrelated: -3000,
  };
  score += categoryBonus[cat] ?? 0;

  // 3. Evidence status
  if (hit.confidence >= 85 || hit.contentLabel === "Verified fact") {
    score += 180;
  } else if (hit.confidence >= 50 || hit.contentLabel === "Needs human review") {
    score += 100;
  } else if (hit.contentLabel === "Insufficient evidence" || hit.confidence < 50) {
    score -= 500;
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

  return score;
}

/**
 * Sorts hits deterministically by threat ranking score descending.
 */
export function sortScanHitsByThreat(hits: ScanHit[]): ScanHit[] {
  // Normalize hit classification & ranking_score
  for (const h of hits) {
    const cat = canonicalCategoryFor(h);
    if (cat === "official_content") {
      h.severity = "Low";
      h.category = "Mention";
      h.contentLabel = "Neutral mention";
    }
    /*
     * Evidence-gated hits already carry a threat score computed by the
     * evidence-gated guardrail (evidence confidence, credibility, reach,
     * recency, virality) at scan time — recomputing it here from keyword
     * category bonuses would silently replace an evidence-backed ranking
     * with a keyword-derived one. Only hits with no classification tier
     * (true legacy rows, no evidence gate ran) use the keyword-derived score.
     */
    if (!h.classificationTier) {
      h.threatScore = calculateThreatRankingScore(h);
    }
  }

  return [...hits].sort((a, b) => {
    const scoreA = a.threatScore ?? calculateThreatRankingScore(a);
    const scoreB = b.threatScore ?? calculateThreatRankingScore(b);
    if (scoreB !== scoreA) return scoreB - scoreA;

    // Tie-breaker: recency
    const dateA = a.published ? new Date(a.published).getTime() : 0;
    const dateB = b.published ? new Date(b.published).getTime() : 0;
    return dateB - dateA;
  });
}

/**
 * Logs comprehensive ranking diagnostics as specified in Step 9.
 */
export function logRankingDiagnostics(
  hits: ScanHit[],
  providerTotal: number,
  threatsOnly: boolean = true,
): void {
  const threatRows = hits.filter((h) => !isHarmlessOrOfficial(h));
  const officialRows = hits.filter((h) => canonicalCategoryFor(h) === "official_content");
  const neutralRows = hits.filter((h) => canonicalCategoryFor(h) === "neutral_mention");
  const hiddenRows = hits.filter((h) => isHarmlessOrOfficial(h));

  console.log("========== RANKING ==========");
  console.log(`Provider rows: ${providerTotal}`);
  console.log(`Threat rows: ${threatRows.length}`);
  console.log(`Official rows: ${officialRows.length}`);
  console.log(`Neutral rows: ${neutralRows.length}`);
  console.log(`Hidden rows: ${hiddenRows.length}`);
  console.log(`Threats Only: ${threatsOnly}`);
  console.log("Top 20 ranking:");

  const top20 = hits.slice(0, 20);
  top20.forEach((h, idx) => {
    const cat = canonicalCategoryFor(h);
    const score = h.threatScore ?? calculateThreatRankingScore(h);
    console.log(
      `${idx + 1}. [${h.severity}] [${cat}] Score ${score} - ${h.title.slice(0, 65)} (${h.url})`,
    );

    if (idx < 10 && (cat === "official_content" || isHarmlessOrOfficial(h))) {
      console.warn("WARNING:");
      console.warn("Official content reached Top 10.");
      console.warn(`Reason: Title="${h.title}" URL="${h.url}" Cat="${cat}" Score=${score}`);
    }
  });
  console.log("=============================");
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
