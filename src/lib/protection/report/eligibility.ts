/**
 * Pure removal-eligibility classifier for reporting.
 *
 * This layer only *reads* eligibility rules that already exist: an existing
 * enforcement case's verdict is authoritative, otherwise the module's own
 * verified bar and the customer's authorization/route preconditions decide.
 * It can never grant eligibility the enforcement orchestrator would refuse,
 * and it never creates a case, job, or notice.
 */
import type { ClassifiedDiscovery, ReportDiscovery, ReportEligibility } from "./types";

export interface EligibilityContext {
  /** Verdict already recorded by AutoEnforcementOrchestrator, keyed by target URL. */
  caseByUrl: Map<string, { status: string | null; details: string | null }>;
  /** Domains with a VERIFIED, auto-sendable removal route. */
  verifiedRouteDomains: Set<string>;
  /** Customer-level preconditions, read from existing authorization data. */
  authorizationActive: boolean;
  assetOwnershipVerified: boolean;
}

export function normalizeUrlKey(url: string | null): string {
  if (!url) return "";
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

export function domainOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const NOT_ELIGIBLE_REASONS: Record<string, string> = {
  reputation_web_scan:
    "Informational mention — below the confirmed-harm threshold for a removal request.",
  copyright_intel: "Visual similarity below the confirmed-match threshold.",
  deepfake_intel: "Synthetic-media and identity signals did not both confirm a violation.",
  youtube_removal: "Commentary or coverage without a confirmed, removable violation.",
};

function mapCaseStatus(status: string | null): ReportEligibility | null {
  switch (status) {
    case "AUTO_ELIGIBLE":
      return "REMOVAL_ELIGIBLE";
    case "REVIEW_REQUIRED":
      return "REQUIRES_REVIEW";
    case "NOT_ELIGIBLE":
      return "NOT_REMOVAL_ELIGIBLE";
    default:
      return null;
  }
}

export function classifyDiscovery(
  discovery: ReportDiscovery,
  ctx: EligibilityContext,
): ClassifiedDiscovery {
  const existing = ctx.caseByUrl.get(normalizeUrlKey(discovery.sourceUrl));
  const fromCase = existing ? mapCaseStatus(existing.status) : null;
  if (fromCase) {
    return {
      ...discovery,
      eligibility: fromCase,
      eligibilityReasons: [
        existing?.details ||
          "Decision recorded by the enforcement eligibility engine for this target.",
      ],
    };
  }

  if (!discovery.moduleVerified) {
    return {
      ...discovery,
      eligibility: "NOT_REMOVAL_ELIGIBLE",
      eligibilityReasons: [
        NOT_ELIGIBLE_REASONS[discovery.module] ??
          "Did not clear this module's confirmed-finding threshold.",
        "Kept as evidence only — no removal request is prepared.",
      ],
    };
  }

  const missing: string[] = [];
  if (!ctx.authorizationActive) {
    missing.push("Client authorization is not ACTIVE for enforcement.");
  }
  if (!ctx.assetOwnershipVerified) {
    missing.push("Asset ownership for this subject is not verified yet.");
  }
  const domain = domainOf(discovery.sourceUrl);
  if (!domain || !ctx.verifiedRouteDomains.has(domain)) {
    missing.push(
      domain
        ? `No verified removal route on record for ${domain}.`
        : "No resolvable host for this discovery.",
    );
  }

  if (missing.length > 0) {
    return { ...discovery, eligibility: "REQUIRES_REVIEW", eligibilityReasons: missing };
  }

  return {
    ...discovery,
    eligibility: "REMOVAL_ELIGIBLE",
    eligibilityReasons: [
      "Confirmed finding, authorization active, ownership verified, verified removal route on record.",
      "Eligibility only — sending remains gated by the pre-send gate.",
    ],
  };
}

export function classifyDiscoveries(
  discoveries: ReportDiscovery[],
  ctx: EligibilityContext,
): ClassifiedDiscovery[] {
  return discoveries.map((d) => classifyDiscovery(d, ctx));
}

export function countByEligibility(discoveries: ClassifiedDiscovery[]) {
  return {
    discovered: discoveries.length,
    eligible: discoveries.filter((d) => d.eligibility === "REMOVAL_ELIGIBLE").length,
    review: discoveries.filter((d) => d.eligibility === "REQUIRES_REVIEW").length,
    notEligible: discoveries.filter((d) => d.eligibility === "NOT_REMOVAL_ELIGIBLE").length,
  };
}
