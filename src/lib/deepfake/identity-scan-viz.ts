/**
 * Pure presentation helpers for the identity-scanning visualization.
 * No scan pipeline / API / persistence logic lives here.
 */

export type IdentityScanVizStatus =
  | "idle"
  | "running"
  | "partial"
  | "completed"
  | "failed";

export type IdentityScanVizMode = IdentityScanVizStatus | "empty";

export type IdentityScanNodeId =
  | "face_reference"
  | "identity_match"
  | "web_discovery"
  | "media_analysis"
  | "url_verification"
  | "evidence_classification";

export type IdentityScanNode = {
  id: IdentityScanNodeId;
  label: string;
  /** Angle in degrees around the portrait (0 = top). */
  angleDeg: number;
};

export const IDENTITY_SCAN_NODES: readonly IdentityScanNode[] = [
  { id: "face_reference", label: "Face reference", angleDeg: -80 },
  { id: "identity_match", label: "Identity match", angleDeg: -30 },
  { id: "web_discovery", label: "Web discovery", angleDeg: 25 },
  { id: "media_analysis", label: "Media analysis", angleDeg: 70 },
  { id: "url_verification", label: "URL verification", angleDeg: 130 },
  { id: "evidence_classification", label: "Evidence classification", angleDeg: 180 },
] as const;

/** Human-readable stage copy driven only by real checkpoint/metrics stages. */
export function identityScanStageMessage(stage?: string | null): string | null {
  if (!stage || typeof stage !== "string") return null;
  const map: Record<string, string> = {
    discovering: "Searching public sources",
    verifying: "Validating evidence URLs",
    classifying: "Inspecting media",
    saving: "Saving verified findings",
    checkpoint: "Verified progress saved",
    done: "Scan complete",
  };
  return map[stage] ?? null;
}

/**
 * Map real pipeline stages onto surrounding intelligence nodes.
 * Nodes at or before the active stage are considered active/complete.
 */
export function activeIdentityScanNodeIds(
  stage?: string | null,
  status?: IdentityScanVizStatus | null,
): IdentityScanNodeId[] {
  if (status === "idle" || status === "failed") {
    return status === "idle" ? ["face_reference"] : [];
  }
  if (status === "completed") {
    return IDENTITY_SCAN_NODES.map((node) => node.id);
  }
  if (status === "partial") {
    return [
      "face_reference",
      "identity_match",
      "web_discovery",
      "media_analysis",
      "url_verification",
    ];
  }

  const stageOrder: Record<string, IdentityScanNodeId[]> = {
    discovering: ["face_reference", "identity_match", "web_discovery"],
    verifying: [
      "face_reference",
      "identity_match",
      "web_discovery",
      "media_analysis",
      "url_verification",
    ],
    classifying: [
      "face_reference",
      "identity_match",
      "web_discovery",
      "media_analysis",
      "url_verification",
      "evidence_classification",
    ],
    saving: [
      "face_reference",
      "identity_match",
      "web_discovery",
      "media_analysis",
      "url_verification",
      "evidence_classification",
    ],
    checkpoint: [
      "face_reference",
      "identity_match",
      "web_discovery",
      "media_analysis",
      "url_verification",
    ],
    done: IDENTITY_SCAN_NODES.map((node) => node.id),
  };

  if (!stage) return ["face_reference", "identity_match"];
  return stageOrder[stage] ?? ["face_reference", "identity_match"];
}

export function resolveIdentityScanVizMode(input: {
  hasSelectedProfile: boolean;
  scanStatus?: string | null;
}): IdentityScanVizMode {
  if (!input.hasSelectedProfile) return "empty";
  const status = input.scanStatus ?? null;
  if (status === "running") return "running";
  if (status === "partial") return "partial";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "idle";
}

export function identityScanStatusHeadline(mode: IdentityScanVizMode): string {
  switch (mode) {
    case "empty":
      return "";
    case "idle":
      return "Ready to scan.";
    case "running":
      return "Identity scan in progress";
    case "partial":
      return "Verified progress saved";
    case "completed":
      return "Identity scan complete";
    case "failed":
      return "Scan failed";
    default:
      return "";
  }
}

export function identityModelReadyCopy(enrolledCount: number): {
  enrollmentLine: string;
  modelLine: string | null;
} {
  const count = Math.max(0, Math.floor(enrolledCount));
  return {
    enrollmentLine:
      count === 1
        ? "1 reference photo enrolled"
        : `${count} reference photos enrolled`,
    modelLine: count >= 3 ? "Identity model ready." : null,
  };
}

/** Only surface real persisted counters — never invent percentages. */
export function identityScanProgressMetrics(input: {
  executedQueries?: number | null;
  plannedQueries?: number | null;
  pagesVerified?: number | null;
  threatsSaved?: number | null;
}): Array<{ key: string; label: string; value: number }> {
  const out: Array<{ key: string; label: string; value: number }> = [];
  if (
    typeof input.executedQueries === "number" &&
    Number.isFinite(input.executedQueries)
  ) {
    out.push({
      key: "queries",
      label:
        typeof input.plannedQueries === "number" &&
        Number.isFinite(input.plannedQueries) &&
        input.plannedQueries > 0
          ? `Queries ${input.executedQueries}/${input.plannedQueries}`
          : `Queries ${input.executedQueries}`,
      value: input.executedQueries,
    });
  }
  if (
    typeof input.pagesVerified === "number" &&
    Number.isFinite(input.pagesVerified)
  ) {
    out.push({
      key: "pages",
      label: `${input.pagesVerified} pages verified`,
      value: input.pagesVerified,
    });
  }
  if (
    typeof input.threatsSaved === "number" &&
    Number.isFinite(input.threatsSaved)
  ) {
    out.push({
      key: "threats",
      label: `${input.threatsSaved} threats saved`,
      value: input.threatsSaved,
    });
  }
  return out;
}

export function shouldAnimateIdentityScan(
  mode: IdentityScanVizMode,
  prefersReducedMotion: boolean,
): boolean {
  if (prefersReducedMotion) return false;
  return mode === "running" || mode === "idle";
}

export function identityScanRingTone(
  mode: IdentityScanVizMode,
): "cyan" | "amber" | "green" | "red" | "muted" {
  switch (mode) {
    case "running":
      return "cyan";
    case "partial":
      return "amber";
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "idle":
      return "cyan";
    default:
      return "muted";
  }
}

/** Pick a single primary reference face for the thumbnail — never all five. */
export function pickPrimaryReferenceFace<T extends { created_at?: string | null }>(
  faces: T[] | null | undefined,
): T | null {
  if (!faces?.length) return null;
  return [...faces].sort((a, b) => {
    const aAt = a.created_at ? Date.parse(a.created_at) : 0;
    const bAt = b.created_at ? Date.parse(b.created_at) : 0;
    return aAt - bAt;
  })[0] ?? null;
}
