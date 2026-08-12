import type { V2AccountType } from "@/lib/onboarding/v2-config";
import { isRepresentativeAccount } from "@/lib/onboarding/v2-config";

/**
 * Client-type based workspace shaping.
 *
 * Nothing is deleted from the product: every module keeps its route and code.
 * Simplified workspaces only *hide* modules from navigation based on the
 * existing `client_profiles.onboarding_account_type` value.
 */
export type WorkspaceMode = "celebrity" | "representative" | "enterprise";

export function workspaceModeFor(accountType: V2AccountType | null): WorkspaceMode {
  if (accountType === "celebrity") return "celebrity";
  if (isRepresentativeAccount(accountType)) return "representative";
  return "enterprise";
}

/**
 * Routes visible in the simplified celebrity workspace. Everything else in the
 * enterprise sidebar (threat radar, narrative intelligence, channel watch,
 * YouTube removal intel, deepfake intel, enforcement, cases, removal center,
 * reports, verified assets, admin tooling) stays reachable by URL but is not
 * advertised to public figures.
 */
export const CELEBRITY_NAV_ROUTES = [
  "/",
  "/scan",
  "/face-protection",
  "/campaigns",
  "/notifications",
  "/evidence-vault",
  "/settings",
] as const;

/** Celebrity-facing labels for shared routes. */
export const CELEBRITY_NAV_LABELS: Record<string, string> = {
  "/": "Home",
  "/scan": "Reputation Scanner",
  "/face-protection": "Face Protection",
  "/campaigns": "Copyright & Campaign Protection",
  "/notifications": "Alerts",
  "/evidence-vault": "Evidence",
  "/settings": "Profile & Settings",
};

/** Representatives get the celebrity set plus multi-profile management tools. */
export const REPRESENTATIVE_EXTRA_ROUTES = ["/assets", "/cases", "/reports"] as const;

export function visibleNavRoutes(mode: WorkspaceMode): string[] | null {
  if (mode === "celebrity") return [...CELEBRITY_NAV_ROUTES];
  if (mode === "representative")
    return [...CELEBRITY_NAV_ROUTES, ...REPRESENTATIVE_EXTRA_ROUTES];
  return null; // enterprise: unchanged, show everything
}
