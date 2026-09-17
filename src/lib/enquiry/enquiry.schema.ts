import { z } from "zod";

/**
 * Single source of truth for the universal enquiry modal's taxonomy and
 * validation. Shared between the client (EternaInquiryModal) and the
 * server function (submitEnquiry) so the two can never drift apart.
 *
 * Every enum here is deliberately closed to what the site already offers:
 * no invented departments, protection services, partnership programs, or
 * privacy rights beyond what src/routes/privacy.tsx Section 9 documents.
 */

export const ENQUIRY_DEPARTMENTS = [
  "protection",
  "security",
  "privacy",
  "partnership",
  "media",
  "general",
  "other",
] as const;
export type EnquiryDepartment = (typeof ENQUIRY_DEPARTMENTS)[number];

export const DEPARTMENT_OPTIONS: Array<{
  value: EnquiryDepartment;
  eyebrow: string;
  title: string;
}> = [
  { value: "protection", eyebrow: "PROTECTION", title: "Request Protection" },
  { value: "security", eyebrow: "SECURITY", title: "Security Enquiry" },
  { value: "privacy", eyebrow: "PRIVACY", title: "Privacy Enquiry" },
  { value: "partnership", eyebrow: "PARTNERSHIPS", title: "Partnership Enquiry" },
  { value: "media", eyebrow: "MEDIA", title: "Media / Press" },
  { value: "general", eyebrow: "GENERAL", title: "General Enquiry" },
  { value: "other", eyebrow: "OTHER", title: "Other" },
];

export const PROTECTION_SERVICES = [
  "online-reputation",
  "deepfake",
  "ai-impersonation",
  "image-immunization",
  "content-privacy",
  "fake-profile",
  "other",
] as const;
export type ProtectionService = (typeof PROTECTION_SERVICES)[number];

export const PROTECTION_SERVICE_OPTIONS: Array<{
  value: ProtectionService;
  title: string;
  description: string;
}> = [
  {
    value: "online-reputation",
    title: "Online Reputation Protection",
    description: "Harmful, misleading, defamatory or reputation-damaging online content.",
  },
  {
    value: "deepfake",
    title: "Deepfake Protection",
    description: "AI-generated or manipulated images, videos or audio using a person's identity.",
  },
  {
    value: "ai-impersonation",
    title: "AI Impersonation",
    description: "Fake accounts, cloned voices, fake endorsements or identity misuse.",
  },
  {
    value: "image-immunization",
    title: "Image Immunization / EIP",
    description: "Preventative protection for authorized images.",
  },
  {
    value: "content-privacy",
    title: "Content & Privacy Protection",
    description: "Unauthorized publishing, misuse or exposure of protected content.",
  },
  {
    value: "fake-profile",
    title: "Fake Account / Impersonation Profile",
    description: "Accounts pretending to represent an individual or organization.",
  },
  {
    value: "other",
    title: "Other Protection Need",
    description: "Another issue requiring Eterna's review.",
  },
];

export const PROFILE_TYPES = [
  "individual",
  "public-figure",
  "corporate",
  "representative",
  "other",
] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export const PROFILE_TYPE_OPTIONS: Array<{
  value: ProfileType;
  title: string;
  description: string;
}> = [
  {
    value: "individual",
    title: "Individual Protection",
    description: "For personal identity, privacy or reputation protection.",
  },
  {
    value: "public-figure",
    title: "Celebrity / Public Figure",
    description:
      "For actors, artists, creators, executives, influencers and other public-facing people.",
  },
  {
    value: "corporate",
    title: "Company / Corporate",
    description: "For companies, brands, institutions and organizations.",
  },
  {
    value: "representative",
    title: "I represent someone",
    description: "For managers, agents, legal representatives or authorized teams.",
  },
  { value: "other", title: "Other", description: "Another kind of profile or entity." },
];

export const SECURITY_TOPICS = [
  "website-security",
  "account-security",
  "data-privacy-security",
  "responsible-disclosure",
  "technical-question",
  "other",
] as const;
export type SecurityTopic = (typeof SECURITY_TOPICS)[number];

export const SECURITY_TOPIC_OPTIONS: Array<{ value: SecurityTopic; title: string }> = [
  { value: "website-security", title: "Website / Platform Security" },
  { value: "account-security", title: "Account Security" },
  { value: "data-privacy-security", title: "Data / Privacy Security" },
  { value: "responsible-disclosure", title: "Responsible Disclosure" },
  { value: "technical-question", title: "Technical Security Question" },
  { value: "other", title: "Other" },
];

// Matches src/routes/privacy.tsx Section 9's actual rights vocabulary
// (Access, Correction, Deletion, Data export, Withdrawal of consent)
// rather than inventing new terms.
export const PRIVACY_TOPICS = [
  "access",
  "correction",
  "deletion",
  "data-export",
  "withdraw-consent",
  "privacy-concern",
  "other",
] as const;
export type PrivacyTopic = (typeof PRIVACY_TOPICS)[number];

export const PRIVACY_TOPIC_OPTIONS: Array<{ value: PrivacyTopic; title: string }> = [
  { value: "access", title: "Access to My Information" },
  { value: "correction", title: "Correction of Information" },
  { value: "deletion", title: "Deletion of Information" },
  { value: "data-export", title: "Data Export" },
  { value: "withdraw-consent", title: "Withdrawal of Consent" },
  { value: "privacy-concern", title: "Privacy Concern" },
  { value: "other", title: "Other" },
];

export const PARTNERSHIP_TYPES = [
  "business",
  "technology",
  "agency-representative",
  "institution",
  "research-collaboration",
  "other",
] as const;
export type PartnershipType = (typeof PARTNERSHIP_TYPES)[number];

export const PARTNERSHIP_TYPE_OPTIONS: Array<{ value: PartnershipType; title: string }> = [
  { value: "business", title: "Business Partnership" },
  { value: "technology", title: "Technology Partnership" },
  { value: "agency-representative", title: "Agency / Representative" },
  { value: "institution", title: "Institution / Organization" },
  { value: "research-collaboration", title: "Research Collaboration" },
  { value: "other", title: "Other" },
];

export const MEDIA_TYPES = [
  "press",
  "interview",
  "company-info",
  "research-eip-info",
  "other",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_TYPE_OPTIONS: Array<{ value: MediaType; title: string }> = [
  { value: "press", title: "Press Enquiry" },
  { value: "interview", title: "Interview Request" },
  { value: "company-info", title: "Company Information" },
  { value: "research-eip-info", title: "Research / EIP Information" },
  { value: "other", title: "Other" },
];

export const PLATFORMS = [
  "instagram",
  "youtube",
  "facebook",
  "x",
  "tiktok",
  "reddit",
  "news-web",
  "google-search",
  "multiple-platforms",
  "other",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_OPTIONS: Array<{ value: Platform; title: string }> = [
  { value: "instagram", title: "Instagram" },
  { value: "youtube", title: "YouTube" },
  { value: "facebook", title: "Facebook" },
  { value: "x", title: "X" },
  { value: "tiktok", title: "TikTok" },
  { value: "reddit", title: "Reddit" },
  { value: "news-web", title: "News / Web" },
  { value: "google-search", title: "Google Search" },
  { value: "multiple-platforms", title: "Multiple Platforms" },
  { value: "other", title: "Other" },
];

/** What a CTA passes in to preselect the modal's flow. */
export interface EnquiryPrefill {
  sourcePage?: string;
  sourceCta?: string;
  department?: EnquiryDepartment;
  protectionService?: ProtectionService;
  profileType?: ProfileType;
}

export const EnquirySubmissionInput = z.object({
  department: z.enum(ENQUIRY_DEPARTMENTS),
  protectionService: z.enum(PROTECTION_SERVICES).optional().nullable(),
  profileType: z.enum(PROFILE_TYPES).optional().nullable(),
  profileName: z.string().trim().max(160).optional().nullable(),
  roleTitle: z.string().trim().max(120).optional().nullable(),
  securityTopic: z.enum(SECURITY_TOPICS).optional().nullable(),
  privacyTopic: z.enum(PRIVACY_TOPICS).optional().nullable(),
  partnershipType: z.enum(PARTNERSHIP_TYPES).optional().nullable(),
  mediaType: z.enum(MEDIA_TYPES).optional().nullable(),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(7).max(24),
  organization: z.string().trim().max(160).optional().nullable(),
  message: z.string().trim().max(4000).optional().nullable(),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional().nullable(),
  relevantUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .refine((v) => !v || /^https?:\/\/.+/i.test(v), {
      message: "Enter a full link starting with http:// or https://",
    }),
  sourcePage: z.string().trim().max(200).optional().nullable(),
  sourceCta: z.string().trim().max(120).optional().nullable(),
});

export type EnquirySubmissionInput = z.infer<typeof EnquirySubmissionInput>;
