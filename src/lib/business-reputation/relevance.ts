export type RelevanceDecision = {
  score: number;
  band: "verified" | "high_confidence" | "review_required" | "rejected";
  reasons: string[];
};

export function scoreBusinessRelevance(input: {
  title: string;
  description?: string;
  url?: string;
  businessName: string;
  aliases?: string[];
  domain?: string | null;
  city?: string | null;
  industry?: string | null;
  executiveNames?: string[];
}): RelevanceDecision {
  const text = `${input.title} ${input.description || ""}`.toLocaleLowerCase();
  const nameTerms = [input.businessName, ...(input.aliases || [])]
    .map((x) => x.toLocaleLowerCase())
    .filter(Boolean);
  let score = 0;
  const reasons: string[] = [];
  if (nameTerms.some((term) => text.includes(term))) {
    score += 35;
    reasons.push("business name or alias match");
  }
  if (
    input.domain &&
    (input.url?.toLocaleLowerCase().includes(input.domain.toLocaleLowerCase()) ||
      text.includes(input.domain.toLocaleLowerCase()))
  ) {
    score += 30;
    reasons.push("official domain match");
  }
  if (input.city && text.includes(input.city.toLocaleLowerCase())) {
    score += 15;
    reasons.push("branch location match");
  }
  if (input.industry && text.includes(input.industry.toLocaleLowerCase())) {
    score += 10;
    reasons.push("industry match");
  }
  if ((input.executiveNames || []).some((name) => text.includes(name.toLocaleLowerCase()))) {
    score += 10;
    reasons.push("executive match");
  }
  const band =
    score >= 85
      ? "verified"
      : score >= 70
        ? "high_confidence"
        : score >= 50
          ? "review_required"
          : "rejected";
  return { score, band, reasons };
}
