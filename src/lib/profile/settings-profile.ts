/**
 * Settings / Profile presentation model.
 *
 * Pure mapping from the AUTHENTICATED user's own persisted `client_profiles`
 * row to the fields shown in Settings. There are deliberately no demo,
 * seed or placeholder values here: a missing field stays empty and renders as
 * "Not provided". Never introduce a fallback profile object in this file.
 */

export const NOT_PROVIDED = "Not provided";

/** Account types that are personal — company / role must never be shown. */
const PERSONAL_ACCOUNT_TYPES = new Set(["celebrity", "individual"]);

/** Client types that are personal in nature. */
const PERSONAL_CLIENT_TYPES = new Set(["celebrity", "individual", "creator"]);

export type ProfileRowLike = {
  legal_name?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  address?: string | null;
  client_type?: string | null;
  company_name?: string | null;
  company_brand_name?: string | null;
  role_title?: string | null;
  client_id?: string | null;
  onboarding_account_type?: string | null;
  onboarding_completed?: boolean | null;
  social_profiles?: unknown;
} | null;

export type SettingsProfileView = {
  /** True when the authenticated user has no persisted profile row yet. */
  isEmpty: boolean;
  legalName: string;
  displayName: string;
  email: string;
  phone: string;
  country: string;
  address: string;
  clientType: string;
  companyName: string;
  roleTitle: string;
  clientId: string;
  accountType: string;
  /** Company / role inputs are only rendered for organizational accounts. */
  showsOrganizationFields: boolean;
  socialProfiles: { label: string; url: string }[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function showsOrganizationFields(row: ProfileRowLike): boolean {
  const accountType = text(row?.onboarding_account_type);
  if (accountType) return !PERSONAL_ACCOUNT_TYPES.has(accountType);
  const clientType = text(row?.client_type);
  if (clientType) return !PERSONAL_CLIENT_TYPES.has(clientType);
  // Unknown account shape: do not surface organization fields speculatively.
  return false;
}

const SOCIAL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  x: "X (Twitter)",
  twitter: "X (Twitter)",
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  website: "Website",
};

function readSocialProfiles(value: unknown): { label: string; url: string }[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const out: { label: string; url: string }[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const url = text(raw);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    out.push({ label: SOCIAL_LABELS[key] ?? key, url });
  }
  return out;
}

/**
 * Builds the Settings view for the signed-in user.
 *
 * `authEmail` is the authenticated session's own email and is used only when
 * the profile row has no stored email — it is never another user's value.
 */
export function buildSettingsProfileView(
  row: ProfileRowLike,
  authEmail?: string | null,
): SettingsProfileView {
  const organization = showsOrganizationFields(row);
  return {
    isEmpty: !row,
    legalName: text(row?.legal_name) || text(row?.full_name),
    displayName: text(row?.display_name),
    email: text(row?.email) || text(authEmail),
    phone: text(row?.phone),
    country: text(row?.country),
    address: text(row?.address),
    clientType: text(row?.client_type),
    companyName: organization
      ? text(row?.company_name) || text(row?.company_brand_name)
      : "",
    roleTitle: organization ? text(row?.role_title) : "",
    clientId: text(row?.client_id),
    accountType: text(row?.onboarding_account_type),
    showsOrganizationFields: organization,
    socialProfiles: readSocialProfiles(row?.social_profiles),
  };
}

/** Display helper: renders an explicit empty state instead of a placeholder. */
export function displayValue(value: string): string {
  return value ? value : NOT_PROVIDED;
}
