/**
 * Server-side client visibility rules for Deepfake Intelligence.
 *
 * Raw Firecrawl hits, URL_REJECTED rows, UNVERIFIED_LEAD rows and
 * off-target identities must never reach public leads / history / polling.
 */

import {
  isClientVisibleClassification,
} from "./page-evidence.server";
import { isUrlVerified } from "./url-verification.server";
import {
  matchesSelectedIdentity,
  type IdentityTarget,
} from "./identity.server";

export interface ClientFindingRow {
  scan_id: string;
  url: string;
  page_title?: string | null;
  snippet?: string | null;
  finding_classification?: string | null;
  url_verification_status?: string | null;
  final_url?: string | null;
  canonical_url?: string | null;
  discovered_url?: string | null;
}

export interface ClientDiscoveryRow {
  scan_id?: string;
  page_url: string;
  page_title?: string | null;
  snippet?: string | null;
  analysis_status?: string | null;
  source_host?: string | null;
}

/**
 * Client-visible findings require:
 * - URL_VERIFIED
 * - VERIFIED_DEEPFAKE or PROBABLE_DEEPFAKE
 * - identity match to the selected scan target
 * - scan_id scope
 */
export function isClientVisibleFinding(
  finding: ClientFindingRow,
  target: IdentityTarget,
  scanId: string,
): boolean {
  if (finding.scan_id !== scanId) return false;

  if (!isUrlVerified(finding.url_verification_status)) {
    return false;
  }

  if (!isClientVisibleClassification(finding.finding_classification)) {
    return false;
  }

  const identityText = [
    finding.page_title ?? "",
    finding.snippet ?? "",
    finding.final_url ?? finding.url,
  ].join(" ");

  return matchesSelectedIdentity(identityText, target);
}

export function filterClientFindings<T extends ClientFindingRow>(
  findings: T[],
  target: IdentityTarget,
  scanId: string,
): T[] {
  return findings
    .filter((finding) => isClientVisibleFinding(finding, target, scanId))
    .map((finding) => ({
      ...finding,
      url: finding.final_url || finding.url,
    }));
}

/**
 * Latest Public Leads require URL-verified discoveries for the selected
 * scan target. Raw Firecrawl / discovered-only rows are excluded.
 */
export function isClientVisibleDiscovery(
  lead: ClientDiscoveryRow,
  target: IdentityTarget,
  scanId?: string,
): boolean {
  if (scanId && lead.scan_id && lead.scan_id !== scanId) {
    return false;
  }

  if (lead.analysis_status !== "url_verified") {
    return false;
  }

  const identityText = [
    lead.page_title ?? "",
    lead.snippet ?? "",
    lead.page_url,
  ].join(" ");

  return matchesSelectedIdentity(identityText, target);
}

export function filterClientDiscoveries<T extends ClientDiscoveryRow>(
  discoveries: T[],
  target: IdentityTarget,
  scanId?: string,
): T[] {
  return discoveries.filter((lead) =>
    isClientVisibleDiscovery(lead, target, scanId),
  );
}

export function isInternalOnlyClassification(
  classification: string | null | undefined,
): boolean {
  return (
    classification === "UNVERIFIED_LEAD" ||
    classification === "ADULT_NAME_MENTION" ||
    classification === "UNRELATED_ADULT_CONTENT"
  );
}

export function isRejectedUrlStatus(
  status: string | null | undefined,
): boolean {
  return status === "URL_REJECTED";
}
