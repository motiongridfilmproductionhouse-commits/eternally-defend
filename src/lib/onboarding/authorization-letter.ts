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
