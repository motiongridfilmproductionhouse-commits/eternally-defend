/**
 * Canonical hash of the EXACT notice being submitted.
 * Covers the final subject, the final body, the final recipient and the
 * attachment/evidence manifest, so a snapshot can prove what was sent.
 * Pure function — safe to import from tests.
 */

import { createHash } from "crypto";

export interface NoticeManifestEntry {
  label: string;
  key?: string | null;
  reference?: string | null;
}

export interface RenderedNotice {
  caseId: string;
  recipient: string;
  subject: string;
  textBody: string;
  htmlBody?: string | null;
  manifest?: NoticeManifestEntry[];
}

export function canonicalizeNotice(notice: RenderedNotice): string {
  const manifest = (notice.manifest ?? [])
    .map((m) => `${m.label}|${m.key ?? ""}|${m.reference ?? ""}`)
    .sort();

  return [
    `case:${notice.caseId}`,
    `recipient:${notice.recipient.trim().toLowerCase()}`,
    `subject:${notice.subject}`,
    `manifest:${manifest.join(";")}`,
    "body:",
    notice.textBody,
    "html:",
    notice.htmlBody ?? "",
  ].join("\n");
}

/** SHA-256 of the canonical rendering of the notice. */
export function hashRenderedNotice(notice: RenderedNotice): string {
  return createHash("sha256").update(canonicalizeNotice(notice), "utf8").digest("hex");
}
