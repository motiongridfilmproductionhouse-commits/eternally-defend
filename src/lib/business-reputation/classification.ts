export type BusinessClassification = {
  category:
    | "negative_opinion"
    | "customer_complaint"
    | "serious_allegation"
    | "impersonation"
    | "fraud"
    | "news"
    | "regulatory"
    | "neutral"
    | "unverified_allegation";
  reviewRequired: boolean;
  removalCandidate: boolean;
  confirmedViolation: false;
  approvedForReporting: false;
  approvedForLegalEscalation: false;
};

export function classifyBusinessFinding(input: {
  title: string;
  description?: string;
  source?: string;
  author?: string;
}): BusinessClassification {
  const text = `${input.title} ${input.description || ""}`.toLocaleLowerCase();
  let category: BusinessClassification["category"] = "neutral";
  if (/fake .*?(account|support|recruitment|payment)|impersonat/.test(text))
    category = "impersonation";
  else if (/scam|fraud|payment/.test(text)) category = "fraud";
  else if (/regulator|commission|government report|fine/.test(text)) category = "regulatory";
  else if (/news|press|report/.test(`${input.source || ""} ${text}`)) category = "news";
  else if (/alleged|accused|lawsuit|illegal|stole/.test(text)) category = "serious_allegation";
  else if (/complaint|customer service|refund|my order|my experience/.test(text))
    category = "customer_complaint";
  else if (/awful|terrible|hate|bad service|disappointed/.test(text)) category = "negative_opinion";
  else if (/unverified|rumor|allegation/.test(text)) category = "unverified_allegation";
  return {
    category,
    reviewRequired: [
      "serious_allegation",
      "impersonation",
      "fraud",
      "unverified_allegation",
    ].includes(category),
    removalCandidate: ["impersonation", "fraud"].includes(category),
    confirmedViolation: false,
    approvedForReporting: false,
    approvedForLegalEscalation: false,
  };
}
