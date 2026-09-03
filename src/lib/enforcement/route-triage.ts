/**
 * PRESENTATION-ONLY triage for the admin removal queue.
 *
 * This module decides *ordering and labelling* in the operator UI. It has no
 * authority whatsoever: it reads the same `RemovalRouteView` the server
 * already returns and never mutates state, never promotes a route, and never
 * influences eligibility, verification, pre-send gates, the kill switch, the
 * allowlist or the enforcement worker. HIGH here means "this row already
 * passed the existing gates, look at it first", not "this is removable".
 */
import {
  AUTHORITATIVE_METHODS,
  isSameOrganisationRecipient,
} from "./removal-route-policy";
import type { RemovalRouteView } from "./removal-routes.functions";

export type TriagePriority = "HIGH" | "MEDIUM" | "LOW";

export interface RouteTriage {
  priority: TriagePriority;
  /** Operator-facing label. Deliberately never says "removable". */
  label: "READY FOR REMOVAL REVIEW" | "NEEDS VERIFICATION" | "NOT CURRENTLY ACTIONABLE";
  /** Why this row landed in its bucket — shown verbatim in the UI. */
  reasons: string[];
  /** Rank inside the bucket: higher = stronger evidence. */
  score: number;
}

/** Mailboxes that carry no copyright/legal authority on their own. */
const GENERIC_LOCALPARTS = new Set([
  "support",
  "customersupport",
  "info",
  "contact",
  "hello",
  "hi",
  "help",
  "admin",
  "sales",
  "press",
  "media",
  "marketing",
  "feedback",
  "hr",
  "careers",
  "jobs",
  "webmaster",
  "office",
  "enquiries",
  "inquiries",
  "service",
  "customerservice",
  "no-reply",
  "noreply",
]);

const MEDIUM_MIN_CONFIDENCE = 0.3;

function localPart(email: string): string {
  return email.split("@")[0]?.trim().toLowerCase() ?? "";
}

export function isGenericMailbox(email: string | null | undefined): boolean {
  if (!email) return true;
  return GENERIC_LOCALPARTS.has(localPart(email).replaceAll(".", ""));
}

function sameOrganisation(route: RemovalRouteView): boolean {
  if (!route.recipientEmail) return false;
  try {
    return isSameOrganisationRecipient(route.recipientEmail, route.domain);
  } catch {
    return false;
  }
}

export function triageRemovalRoute(route: RemovalRouteView): RouteTriage {
  const reasons: string[] = [];

  const hasRecipient = Boolean(route.recipientEmail);
  const sameOrg = sameOrganisation(route);
  const generic = isGenericMailbox(route.recipientEmail);
  const authoritativePage = Boolean(route.authoritativePageKind);
  const candidateMethod = route.verificationMethodCandidate ?? route.verificationMethod ?? null;
  const authoritativeMethod = Boolean(candidateMethod && AUTHORITATIVE_METHODS.has(candidateMethod));

  // ---- Priority 1: already cleared every existing gate the UI can observe.
  if (route.effectiveStatus === "VERIFIED" && route.canAutoSend && hasRecipient && sameOrg) {
    reasons.push("Route verified by an operator");
    reasons.push("Same-organisation recipient confirmed");
    if (route.verificationMethod) reasons.push(`Evidence: ${route.verificationMethod}`);
    if (route.authoritativeSourceUrl) reasons.push("Authoritative source recorded");
    return {
      priority: "HIGH",
      label: "READY FOR REMOVAL REVIEW",
      reasons,
      score: 100 + route.confidence,
    };
  }

  // ---- Priority 3 disqualifiers (checked before MEDIUM so nothing is oversold).
  const blockers: string[] = [];
  if (route.effectiveStatus === "REJECTED") blockers.push("Route rejected by an operator");
  if (route.effectiveStatus === "STALE") blockers.push("Evidence stale — needs re-verification");
  if (!hasRecipient) blockers.push("No recipient address found");
  if (hasRecipient && !sameOrg) blockers.push("Recipient is not on the target organisation");
  if (generic && hasRecipient) blockers.push("Generic support/info mailbox — no legal authority");
  if (!authoritativePage) blockers.push("No authoritative DMCA/copyright/legal page proven");
  if (route.isGuessedCandidate) blockers.push("Guessed mailbox pattern");
  if (!authoritativeMethod) blockers.push("No authoritative evidence method candidate");
  if (route.confidence < MEDIUM_MIN_CONFIDENCE) {
    blockers.push(`Evidence confidence too low (${route.confidence.toFixed(2)})`);
  }

  if (blockers.length > 0) {
    return {
      priority: "LOW",
      label: "NOT CURRENTLY ACTIONABLE",
      reasons: blockers,
      score: route.confidence,
    };
  }

  // ---- Priority 2: strong candidate evidence, operator verification still required.
  reasons.push(`Authoritative ${route.authoritativePageKind} page evidence captured`);
  reasons.push("Same-organisation recipient on that page");
  reasons.push("Operator verification still required before any enforcement");
  return {
    priority: "MEDIUM",
    label: "NEEDS VERIFICATION",
    reasons,
    score: 50 + route.confidence,
  };
}

const ORDER: Record<TriagePriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export interface TriagedRoute {
  route: RemovalRouteView;
  triage: RouteTriage;
}

/** Sorts routes HIGH → MEDIUM → LOW, strongest evidence first inside a bucket. */
export function triageAndSortRoutes(routes: RemovalRouteView[]): TriagedRoute[] {
  return routes
    .map((route) => ({ route, triage: triageRemovalRoute(route) }))
    .sort((a, b) => {
      const byBucket = ORDER[a.triage.priority] - ORDER[b.triage.priority];
      if (byBucket !== 0) return byBucket;
      if (b.triage.score !== a.triage.score) return b.triage.score - a.triage.score;
      return a.route.domain.localeCompare(b.route.domain);
    });
}
