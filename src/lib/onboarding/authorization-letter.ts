/**
 * Content model for the Eterna Sentinel Defence LLC authorization letter.
 *
 * Pure functions only — no PDF or server imports — so the letter wording,
 * scope mapping and limitations can be unit tested and reused by the renderer.
 */

export const SERVICE_PROVIDER_NAME = "ETERNA SENTINEL DEFENCE LLC";
export const LETTER_TITLE = "Digital Identity, Reputation & Content Protection Authorization";
export const LETTER_UI_LABEL = "Eterna Sentinel Defence LLC Authorization Letter";

/**
 * The seven client-facing authorization categories. Each maps to the granular
 * scope keys captured during onboarding; a category appears in the letter only
 * when at least one of its underlying scopes was selected by the client.
 */
export const AUTHORIZATION_CATEGORIES = [
  {
    id: "reputation_monitoring",
    title: "Reputation and public-web monitoring",
    detail:
      "Monitoring publicly accessible websites, platforms and search results for content referencing the Client.",
    scopeKeys: ["monitor_public", "monitoring_reports"],
  },
  {
    id: "impersonation_detection",
    title: "Impersonation and fraudulent-profile detection",
    detail:
      "Identifying accounts, pages or profiles that falsely present themselves as the Client.",
    scopeKeys: ["prepare_impersonation"],
  },
  {
    id: "face_misuse_detection",
    title: "Face/image misuse and deepfake detection",
    detail:
      "Detecting unauthorized use of the Client's face or likeness, including synthetic or manipulated media.",
    scopeKeys: ["detect_face_misuse"],
  },
  {
    id: "copyright_monitoring",
    title: "Copyright and unauthorized-content monitoring",
    detail:
      "Monitoring for unauthorized reproduction or distribution of content owned or controlled by the Client.",
    scopeKeys: ["prepare_copyright"],
  },
  {
    id: "campaign_asset_monitoring",
    title: "Campaign/asset monitoring",
    detail:
      "Monitoring the verified accounts, channels and campaign assets listed in this authorization.",
    scopeKeys: ["monitor_verified_assets"],
  },
  {
    id: "evidence_preservation",
    title: "Evidence collection and preservation",
    detail:
      "Capturing and preserving timestamped evidence records of identified content for the Client's use.",
    scopeKeys: ["collect_evidence"],
  },
  {
    id: "platform_reports",
    title: "Preparing/submitting platform reports or takedown requests when separately authorized",
    detail:
      "Preparing reports or takedown requests, and submitting them only where the Client has separately authorized submission.",
    scopeKeys: [
      "prepare_privacy",
      "prepare_hosting",
      "communicate_platforms",
      "track_enforcement",
      "follow_up_cases",
      "submit_final_after_approval",
    ],
  },
] as const;

export type AuthorizationCategory = (typeof AUTHORIZATION_CATEGORIES)[number];

export type ScopeRow = { scope_key: string; granted: boolean };

/** Scope keys the client actually granted. */
export function grantedScopeKeys(scopes: ScopeRow[] | null | undefined): string[] {
  return (scopes ?? []).filter((s) => s.granted).map((s) => s.scope_key);
}

/**
 * Categories covered by this authorization — only those with at least one
 * granted underlying scope. Never returns every category by default.
 */
export function selectedCategories(
  scopes: ScopeRow[] | null | undefined,
): AuthorizationCategory[] {
  const granted = new Set(grantedScopeKeys(scopes));
  return AUTHORIZATION_CATEGORIES.filter((c) => c.scopeKeys.some((k) => granted.has(k)));
}

/** True when the client separately authorized final platform submission. */
export function hasSubmissionAuthority(scopes: ScopeRow[] | null | undefined): boolean {
  return grantedScopeKeys(scopes).includes("submit_final_after_approval");
}

/**
 * The enforcement/authority level derived from the onboarding selections.
 * MONITORING_ONLY is the floor; nothing here implies unlimited authority.
 */
export function authorizationLevel(
  scopes: ScopeRow[] | null | undefined,
): "MONITORING_ONLY" | "REPORT_PREPARATION" | "REPORT_SUBMISSION" {
  const granted = new Set(grantedScopeKeys(scopes));
  if (granted.has("submit_final_after_approval")) return "REPORT_SUBMISSION";
  const preparation = [
    "prepare_copyright",
    "prepare_privacy",
    "prepare_impersonation",
    "prepare_hosting",
    "communicate_platforms",
  ];
  if (preparation.some((k) => granted.has(k))) return "REPORT_PREPARATION";
  return "MONITORING_ONLY";
}

export const AUTHORIZATION_LEVEL_LABELS: Record<
  ReturnType<typeof authorizationLevel>,
  string
> = {
  MONITORING_ONLY: "Monitoring and evidence only — no reports submitted on the Client's behalf",
  REPORT_PREPARATION:
    "Monitoring, evidence and report preparation — submission requires separate written authorization",
  REPORT_SUBMISSION:
    "Monitoring, evidence, report preparation and submission of platform reports as separately authorized",
};

/** Limitations paragraph list. These are mandatory in every issued letter. */
export function limitationClauses(scopes: ScopeRow[] | null | undefined): string[] {
  const level = authorizationLevel(scopes);
  return [
    `Ownership of the Client's identity, likeness, name, brand and content remains solely with the Client. This authorization transfers no ownership, assignment or licence of any intellectual property.`,
    `This authorization is limited to the protection services expressly selected by the Client and listed above. Any service not listed is not authorized.`,
    `${SERVICE_PROVIDER_NAME} may not enter into contracts, settlements, licensing arrangements or any other agreements unrelated to the selected protection services on the Client's behalf.`,
    `Destructive or enforcement actions — including takedown submissions, platform complaints and account-removal requests — are permitted only to the extent of the authorization level selected during onboarding: ${AUTHORIZATION_LEVEL_LABELS[level]}.`,
    `This authorization may be revoked by the Client at any time in accordance with the terms of the service agreement, and terminates automatically on the expiry date stated above unless renewed in writing.`,
    `Final decisions on any reported content rest solely with the relevant platforms, hosting providers and competent authorities. ${SERVICE_PROVIDER_NAME} does not guarantee removal, suspension or any specific legal outcome.`,
  ];
}

export type LetterParty = {
  legalName: string;
  displayName: string;
  clientType: string;
  country: string;
};

/** Resolve party fields from the onboarding profile snapshot, with safe fallbacks. */
export function resolveClientParty(profile: Record<string, any> | null | undefined): LetterParty {
  const legalName =
    (profile?.legal_name || profile?.full_name || profile?.display_name || "").trim() ||
    "Not provided";
  const displayName =
    (profile?.display_name || profile?.artist_name || "").trim() || legalName;
  const rawType = (profile?.client_type || profile?.account_type || "").trim();
  const clientType = rawType ? formatClientType(rawType) : "Not specified";
  return {
    legalName,
    displayName,
    clientType,
    country: (profile?.country || "").trim() || "Not provided",
  };
}

export function formatClientType(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type LetterAsset = { label: string; meta: string };

/** Verified digital assets covered by the authorization. */
export function coveredAssets(assets: any[] | null | undefined): LetterAsset[] {
  return (assets ?? [])
    .filter((a) => a?.verification_status === "VERIFIED")
    .map((a) => ({
      label: `${String(a.kind ?? "asset").toUpperCase()} — ${a.name ?? a.handle ?? a.channel_id ?? "Unnamed asset"}`,
      meta: a.url ?? a.channel_url ?? a.handle ?? "",
    }));
}

/** Footer text carried on every page of the generated PDF. */
export function footerText(authNumber: string, version: number | string): string {
  return `Authorization ID: ${authNumber}  |  Document Version: v${version}  |  ${SERVICE_PROVIDER_NAME}`;
}

/** The authorizing paragraph — deliberately scoped, never open-ended. */
export function authorizingParagraph(party: LetterParty): string {
  return `The undersigned, ${party.legalName}${party.displayName && party.displayName !== party.legalName ? ` (professionally known as ${party.displayName})` : ""}, hereinafter the "Client", hereby authorizes ${SERVICE_PROVIDER_NAME}, hereinafter the "Service Provider", to provide authorized digital protection and monitoring services on the Client's behalf, strictly limited to the services selected by the Client and set out in this authorization.`;
}

// ---------------------------------------------------------------------------
// AUTHORIZED PROTECTION SERVICES — client-facing presentation model.
// Plain-language service descriptions for the issued letter. No internal
// scope keys, classifier values, verification-provider names or biometric
// implementation details are ever rendered from here.
// ---------------------------------------------------------------------------

export type ProtectionService = {
  id: string;
  title: string;
  intro: string;
  bullets: string[];
  closing?: string;
  scopeKeys: string[];
};

export const PROTECTION_SERVICES: ProtectionService[] = [
  {
    id: "internet_reputation",
    title: "Internet & Reputation Protection",
    intro:
      "Monitor publicly accessible internet sources for references to the Client, including search engines, websites, news, blogs, forums and supported social platforms, in order to identify potentially:",
    bullets: [
      "defamatory or harmful content",
      "impersonation",
      "false or misleading representations",
      "reputation threats",
      "unauthorized use of the Client's identity",
    ],
    closing:
      "Where legally and contractually permitted, the Service Provider may collect and preserve evidence and prepare appropriate platform reports or removal requests. Lawful criticism, opinion, journalism and other legitimate content are not automatically removable, and no such outcome is promised.",
    scopeKeys: ["monitor_public", "monitoring_reports"],
  },
  {
    id: "social_media",
    title: "Social Media Protection",
    intro:
      "Monitor the official social profiles supplied by the Client, together with public references across supported platforms, including:",
    bullets: ["Instagram", "Facebook", "YouTube", "X", "TikTok", "Threads", "other supplied profiles"],
    closing:
      "The purpose of this monitoring is to detect suspected fake accounts, impersonation, unauthorized identity use and suspicious copies of the Client's profiles or content.",
    scopeKeys: ["monitor_verified_assets", "prepare_impersonation", "monitor_public"],
  },
  {
    id: "youtube_video",
    title: "YouTube & Video Protection",
    intro:
      "Monitor the YouTube channels and videos supplied by the Client, and supported public video sources, for:",
    bullets: [
      "unauthorized copies",
      "copyright misuse",
      "impersonation",
      "misleading edits",
      "unauthorized promotional use",
      "identity or face misuse",
    ],
    scopeKeys: ["monitor_verified_assets", "prepare_copyright"],
  },
  {
    id: "face_likeness",
    title: "Face & Likeness Protection",
    intro:
      "Use the facial reference enrolled by the Client during onboarding solely for authorized identity-protection scanning, and monitor supported sources for suspected:",
    bullets: [
      "unauthorized use of the Client's face",
      "impersonation",
      "manipulated imagery",
      "synthetic or deepfake content",
      "misleading use of the Client's likeness",
    ],
    scopeKeys: ["detect_face_misuse"],
  },
  {
    id: "copyright_campaign",
    title: "Copyright & Campaign Protection",
    intro:
      "Monitor copyright-protected assets and campaign materials supplied by the Client, including:",
    bullets: [
      "photographs",
      "posters",
      "videos",
      "trailers",
      "music and promotional material",
      "advertisements",
      "campaign assets",
    ],
    closing:
      "The Service Provider may detect suspected unauthorized copies or misuse of these materials and preserve the relevant evidence.",
    scopeKeys: ["prepare_copyright", "monitor_verified_assets"],
  },
  {
    id: "evidence_removal",
    title: "Evidence & Removal Assistance",
    intro: "The Client authorizes the Service Provider to:",
    bullets: [
      "identify suspected violations",
      "collect relevant public evidence",
      "preserve URLs, screenshots and metadata where supported",
      "prepare platform complaints",
      "prepare copyright notices",
      "prepare impersonation reports",
      "prepare privacy and identity-misuse reports",
      "track submitted cases",
      "communicate with platforms where authorized",
    ],
    closing:
      "Any final submission or enforcement action must follow the authorization level selected by the Client and applicable law and platform rules.",
    scopeKeys: [
      "collect_evidence",
      "prepare_copyright",
      "prepare_privacy",
      "prepare_impersonation",
      "prepare_hosting",
      "communicate_platforms",
      "track_enforcement",
      "follow_up_cases",
      "submit_final_after_approval",
    ],
  },
];

/** Services covered by this authorization — only those backed by a granted scope. */
export function selectedServices(scopes: ScopeRow[] | null | undefined): ProtectionService[] {
  const granted = new Set(grantedScopeKeys(scopes));
  return PROTECTION_SERVICES.filter((s) => s.scopeKeys.some((k) => granted.has(k)));
}

/** Mandatory removal-authority wording. Never an unconditional right to remove. */
export const REMOVAL_AUTHORITY_CLAUSE = `The Client authorizes ${SERVICE_PROVIDER_NAME} to request removal, restriction, correction, de-indexing, or other appropriate platform action concerning content reasonably believed to infringe the Client's rights, subject to applicable law, platform policies, the Client's authorization scope, and any required client approval.`;

/** Mandatory no-guarantee wording. */
export const NO_GUARANTEE_CLAUSE = `${SERVICE_PROVIDER_NAME} does not control third-party platforms and cannot guarantee removal, suspension, de-indexing, or any particular legal or platform outcome.`;

export type PresenceGroup = { platform: string; entries: { label: string; url: string }[] };

const PLATFORM_MATCHERS: { platform: string; test: RegExp }[] = [
  { platform: "YouTube", test: /youtu\.?be|youtube/i },
  { platform: "Instagram", test: /instagram/i },
  { platform: "Facebook", test: /facebook|fb\.com/i },
  { platform: "X", test: /(^|\W)(x\.com|twitter)/i },
  { platform: "TikTok", test: /tiktok/i },
  { platform: "Threads", test: /threads\./i },
];

function platformOf(value: string): string {
  const hit = PLATFORM_MATCHERS.find((m) => m.test.test(value));
  return hit ? hit.platform : "Other";
}

/**
 * Official digital presence supplied by the Client, grouped per platform.
 * Presentation only — nothing here asserts that a profile was verified.
 */
export function officialDigitalPresence(
  profile: Record<string, any> | null | undefined,
  assets: any[] | null | undefined,
): PresenceGroup[] {
  const groups = new Map<string, { label: string; url: string }[]>();
  const push = (platform: string, label: string, url: string) => {
    const list = groups.get(platform) ?? [];
    if (list.some((e) => (e.url || e.label) === (url || label))) return;
    list.push({ label, url });
    groups.set(platform, list);
  };

  for (const a of assets ?? []) {
    const url = String(a?.url ?? a?.channel_url ?? "").trim();
    const handle = String(a?.handle ?? "").trim();
    const name = String(a?.name ?? "").trim();
    const kind = String(a?.kind ?? "").trim();
    const reference = url || handle || name;
    if (!reference) continue;
    const platform = platformOf(`${kind} ${url} ${handle}`);
    push(platform, name || handle || reference, url || handle);
  }

  const handles = (profile?.social_profiles as any)?.handles;
  for (const raw of Array.isArray(handles) ? handles : []) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    push(platformOf(value), value, /^https?:\/\//i.test(value) ? value : "");
  }

  const website = String(profile?.website ?? "").trim();
  if (website) push("Other", website, website);

  const order = ["YouTube", "Instagram", "Facebook", "X", "TikTok", "Threads", "Other"];
  return order
    .filter((p) => groups.has(p))
    .map((platform) => ({ platform, entries: groups.get(platform)! }));
}

/** Declarations printed in the issued letter. */
export const CLIENT_DECLARATIONS = [
  "The Client owns the listed rights or is legally authorized to represent the rights owner.",
  "The accounts, profiles and assets listed in this authorization belong to the Client or the Client's organization.",
  "The information supplied in this authorization is accurate and complete.",
  "The Client understands that false or abusive complaints may create legal liability.",
  "The Client authorizes the Service Provider only within the protection services stated in this authorization.",
  "Final decisions on reported content rest with the relevant platforms and competent authorities.",
  "No specific removal, suspension, de-indexing or legal outcome is guaranteed.",
];
