export const ONBOARDING_VERSION = "v1";
export const CONSENT_VERSION = "v1";

export const CONSENT_TEXTS = {
  ownership:
    "I confirm that I am the owner of the protected assets listed above or I am legally authorized to act on behalf of the owner.",
  monitoring:
    "I authorize Eterna AI to monitor public content, collect evidence, perform reputation analysis, copyright monitoring, impersonation detection, deepfake detection, and generate enforcement recommendations relating to my protected assets.",
  enforcement:
    "I authorize Eterna AI to prepare and submit copyright, impersonation, trademark, reputation, and platform enforcement requests on my behalf where permitted by law and platform policies.",
  platformFinality:
    "I understand that final platform decisions remain solely with YouTube, Meta, Google, X, Reddit, TikTok, website operators, courts, or other relevant authorities.",
  noGuarantee:
    "I acknowledge that Eterna AI does not guarantee content removal, account suspension, legal outcomes, or platform enforcement.",
} as const;

export type ConsentKey = keyof typeof CONSENT_TEXTS;
export const CONSENT_KEYS: ConsentKey[] = [
  "ownership",
  "monitoring",
  "enforcement",
  "platformFinality",
  "noGuarantee",
];

export const CLIENT_TYPES = [
  { value: "individual", label: "Individual", account: "personal" },
  { value: "celebrity", label: "Celebrity / Public Figure", account: "personal" },
  { value: "creator", label: "Creator / Influencer", account: "personal" },
  { value: "business", label: "Business", account: "business" },
  { value: "corporate", label: "Corporate / Enterprise", account: "business" },
  { value: "agency", label: "Agency Representing Clients", account: "business" },
] as const;

export const AUTHORIZATION_LEVELS = [
  { value: "monitoring", label: "Monitoring Only", desc: "Passive detection and alerts." },
  { value: "monitoring_evidence", label: "Monitoring + Evidence Collection", desc: "We capture and preserve proof." },
  { value: "monitoring_enforcement", label: "Monitoring + Enforcement Requests", desc: "We prepare platform reports for your review." },
  { value: "full_protection", label: "Full Protection", desc: "Monitoring, evidence, and takedown requests." },
] as const;

export const ENTERPRISE_CLIENT_TYPES = new Set(["business", "corporate", "agency"]);
