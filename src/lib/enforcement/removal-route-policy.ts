/**
 * Removal Route Policy — pure, side-effect-free decision layer.
 *
 * Two responsibilities:
 *  1. Decide the removal ROUTE TYPE for a target URL (explicit platform routing,
 *     CDN/proxy handling, independent websites).
 *  2. Decide whether a candidate recipient address may ever be promoted to
 *     VERIFIED, and what evidence is required for that promotion.
 *
 * This module NEVER sends anything and NEVER promotes a route by itself. It only
 * answers questions the enforcement worker and the operator UI ask.
 */

import { classifyPlatform, type PlatformClassification } from "@/lib/media/platform-classifier";

export type RemovalRouteType =
  | "EMAIL_DMCA"
  | "API"
  | "WEB_FORM"
  | "HUMAN_ACTION_REQUIRED"
  | "HOST_ORIGIN_DISCOVERY_REQUIRED"
  | "SEARCH_DELISTING"
  | "UNSUPPORTED";

export type RouteVerificationState =
  | "DISCOVERED_UNVERIFIED"
  | "MANUAL_REVIEW"
  | "VERIFIED"
  | "STALE"
  | "REJECTED"
  | "INVALID"
  | "HOST_ORIGIN_UNKNOWN";

export interface PlatformRouteDecision {
  routeType: RemovalRouteType;
  /** Stable connector id when a connector exists for this route. */
  connectorId: string | null;
  /** Operator-facing label. */
  platformLabel: string;
  platformKind: string;
  /** True when a human must submit through a portal/form. */
  requiresHuman: boolean;
  /** True when automated email delivery is even conceptually allowed. */
  emailEligible: boolean;
  /** True when an evidence package should be prepared for an operator. */
  preparePackage: boolean;
  reason: string;
}

/**
 * Platforms whose official removal process is a web form or authenticated
 * portal. Guessing dmca@<platform> for these is wrong, so they are routed to a
 * human workflow with a prepared package instead.
 */
const HUMAN_PLATFORM_KINDS = new Set([
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "x",
  "pinterest",
  "reddit",
  "telegram",
  "marketplace",
]);

/** Kinds that are UGC platforms but have no Eterna integration at all. */
const UNSUPPORTED_UGC_KINDS = new Set(["image_host", "video_host", "forum"]);

export function decidePlatformRoute(targetUrl: string): PlatformRouteDecision {
  const c: PlatformClassification | null = classifyPlatform(targetUrl);

  if (!c) {
    return {
      routeType: "UNSUPPORTED",
      connectorId: null,
      platformLabel: "Unparseable target",
      platformKind: "unknown",
      requiresHuman: true,
      emailEligible: false,
      preparePackage: false,
      reason: "Target URL could not be parsed; no removal route can be derived.",
    };
  }

  const base = { platformLabel: c.label, platformKind: c.kind };

  if (c.isSearchSurface) {
    return {
      ...base,
      routeType: "SEARCH_DELISTING",
      connectorId: "google_search_delist_connector",
      requiresHuman: true,
      emailEligible: false,
      preparePackage: true,
      reason:
        "Search-engine surface. Search delisting only removes the result from the index — it never removes the source content.",
    };
  }

  if (c.isInfrastructure) {
    return {
      ...base,
      routeType: "HOST_ORIGIN_DISCOVERY_REQUIRED",
      connectorId: null,
      requiresHuman: true,
      emailEligible: false,
      preparePackage: false,
      reason:
        "CDN/proxy host only mirrors the media. The origin host must be established before any notice is addressed.",
    };
  }

  if (c.kind === "youtube") {
    return {
      ...base,
      routeType: "HUMAN_ACTION_REQUIRED",
      connectorId: "youtube_copyright_connector",
      requiresHuman: true,
      emailEligible: false,
      preparePackage: true,
      reason: "YouTube requires webform/CMS submission by an authorised operator.",
    };
  }

  if (HUMAN_PLATFORM_KINDS.has(c.kind)) {
    return {
      ...base,
      routeType: "HUMAN_ACTION_REQUIRED",
      connectorId: null,
      requiresHuman: true,
      emailEligible: false,
      preparePackage: true,
      reason: `${c.label} removal requires its official web form or authenticated portal. Eterna prepares the evidence package for an operator instead of guessing an email address.`,
    };
  }

  if (UNSUPPORTED_UGC_KINDS.has(c.kind)) {
    return {
      ...base,
      routeType: "HUMAN_ACTION_REQUIRED",
      connectorId: null,
      requiresHuman: true,
      emailEligible: false,
      preparePackage: true,
      reason: `${c.label} has no supported Eterna removal integration; handled by the human-action workflow.`,
    };
  }

  // Independent websites, blogs and CMS-hosted pages: email is allowed, but only
  // once an authoritative recipient route reaches VERIFIED.
  return {
    ...base,
    routeType: "EMAIL_DMCA",
    connectorId: "website_copyright_connector",
    requiresHuman: false,
    emailEligible: true,
    preparePackage: false,
    reason:
      "Independent host. Email DMCA is permitted only against an authoritatively verified recipient route.",
  };
}

/* ------------------------------------------------------------------ *
 * Guessed-address detection
 * ------------------------------------------------------------------ */

const GUESSABLE_LOCAL_PARTS = [
  "dmca",
  "copyright",
  "abuse",
  "legal",
  "info",
  "contact",
  "support",
  "admin",
  "webmaster",
  "hostmaster",
  "postmaster",
  "help",
  "privacy",
  "takedown",
];

/** Verification methods that are never authoritative on their own. */
export const NON_AUTHORITATIVE_METHODS = new Set([
  "HEURISTIC_DISCOVERY",
  "GUESSED_PATTERN",
  "SYSTEM_DATABASE",
  "ASSUMED",
]);

/** Verification methods accepted as authoritative operator evidence. */
export const AUTHORITATIVE_METHODS = new Set([
  "PUBLISHED_DMCA_PAGE",
  "PUBLISHED_LEGAL_CONTACT",
  "HOSTING_PROVIDER_ABUSE_PAGE",
  "REGISTRAR_ABUSE_RECORD",
  "PLATFORM_POLICY_DOCUMENTED",
  "OFFICIAL_CORRESPONDENCE",
  "CONTROLLED_TEST_FIXTURE",
]);

export function isGuessedAddress(email: string, domain?: string): boolean {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0) return true;
  const local = e.slice(0, at);
  const host = e.slice(at + 1);
  if (domain) {
    const d = domain.trim().toLowerCase().replace(/^www\./, "");
    // Same-domain generic mailbox is the classic guess.
    if ((host === d || host.endsWith(`.${d}`)) && GUESSABLE_LOCAL_PARTS.includes(local)) return true;
  }
  return GUESSABLE_LOCAL_PARTS.includes(local) && !domain ? true : false;
}

export interface VerificationEvidenceInput {
  recipientEmail?: string | null;
  domain: string;
  routeType: RemovalRouteType;
  verificationMethod?: string | null;
  authoritativeSourceUrl?: string | null;
  evidenceSnapshot?: Record<string, unknown> | null;
  /** Operator identity — verification is an operator-only action. */
  actorIsOperator: boolean;
}

export interface VerificationDecision {
  canVerify: boolean;
  /** Status the route must hold if verification is refused. */
  fallbackStatus: RouteVerificationState;
  issues: string[];
}

/**
 * The only place that decides whether a route may become VERIFIED.
 * A guessed address is refused unless authoritative evidence is attached, and
 * only an operator may verify at all.
 */
export function evaluateVerification(input: VerificationEvidenceInput): VerificationDecision {
  const issues: string[] = [];

  if (!input.actorIsOperator) {
    return {
      canVerify: false,
      fallbackStatus: "DISCOVERED_UNVERIFIED",
      issues: ["Only an admin/operator may verify a removal route."],
    };
  }

  if (input.routeType !== "EMAIL_DMCA") {
    issues.push(
      `Route type ${input.routeType} is not an email route; it cannot be verified as an auto-sendable recipient.`,
    );
  }

  const email = (input.recipientEmail ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    issues.push("A recipient email address is required.");
  }

  const method = (input.verificationMethod ?? "").trim().toUpperCase();
  if (!method) {
    issues.push("A verification method is required.");
  } else if (NON_AUTHORITATIVE_METHODS.has(method)) {
    issues.push(
      `Verification method ${method} is not authoritative. A guessed or system-derived address can never be promoted to VERIFIED.`,
    );
  } else if (!AUTHORITATIVE_METHODS.has(method)) {
    issues.push(`Verification method ${method} is not a recognised authoritative source type.`);
  }

  const src = (input.authoritativeSourceUrl ?? "").trim();
  if (!/^https?:\/\/.+\..+/i.test(src)) {
    issues.push("An authoritative source URL (published DMCA/legal/abuse page) is required.");
  }

  const snapshot = input.evidenceSnapshot ?? {};
  const hasSnapshot =
    Object.keys(snapshot).length > 0 &&
    Boolean(
      (snapshot as any).excerpt ||
        (snapshot as any).snapshot_path ||
        (snapshot as any).html_hash ||
        (snapshot as any).operator_note,
    );
  if (!hasSnapshot) {
    issues.push(
      "Evidence is required: an excerpt, stored snapshot, content hash, or an explicit operator note from the authoritative page.",
    );
  }

  return {
    canVerify: issues.length === 0,
    fallbackStatus: issues.length === 0 ? "VERIFIED" : "MANUAL_REVIEW",
    issues,
  };
}

export const REVERIFY_INTERVAL_DAYS = 90;

export function nextReverifyDueAt(from: Date = new Date()): string {
  return new Date(from.getTime() + REVERIFY_INTERVAL_DAYS * 86400_000).toISOString();
}

export interface RouteRow {
  verification_status?: string | null;
  recipient_email?: string | null;
  contact?: string | null;
  copyright_email?: string | null;
  abuse_email?: string | null;
  route_type?: string | null;
  reverify_due_at?: string | null;
  verified_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface EffectiveRouteState {
  status: RouteVerificationState;
  recipientEmail: string | null;
  isStale: boolean;
  canAutoSend: boolean;
  reason: string;
}

/** Derives send-eligibility from a stored route row. Fail-closed. */
export function effectiveRouteState(
  row: RouteRow | null | undefined,
  now: Date = new Date(),
): EffectiveRouteState {
  if (!row) {
    return {
      status: "DISCOVERED_UNVERIFIED",
      recipientEmail: null,
      isStale: false,
      canAutoSend: false,
      reason: "No stored route for this domain.",
    };
  }

  const recipientEmail =
    row.recipient_email || row.contact || row.copyright_email || row.abuse_email || null;
  let status = ((row.verification_status || "DISCOVERED_UNVERIFIED") as RouteVerificationState);

  const dueRaw = row.reverify_due_at || null;
  const anchor = row.verified_at || row.updated_at || row.created_at || null;
  const due = dueRaw
    ? new Date(dueRaw).getTime()
    : anchor
      ? new Date(anchor).getTime() + REVERIFY_INTERVAL_DAYS * 86400_000
      : null;
  const isStale = status === "VERIFIED" && due !== null && due < now.getTime();
  if (isStale) status = "STALE";

  const routeType = (row.route_type || "EMAIL_DMCA") as RemovalRouteType;
  const canAutoSend =
    status === "VERIFIED" && routeType === "EMAIL_DMCA" && Boolean(recipientEmail?.includes("@"));

  return {
    status,
    recipientEmail,
    isStale,
    canAutoSend,
    reason: canAutoSend
      ? "Authoritatively verified email route."
      : status === "STALE"
        ? "Route verification expired; re-verification required before sending."
        : `Route status ${status} (${routeType}) is not auto-sendable.`,
  };
}
