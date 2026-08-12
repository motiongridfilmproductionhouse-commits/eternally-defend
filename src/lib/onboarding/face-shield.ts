/**
 * Digital Face Shield — post-enrollment protection VISUALIZATION state.
 *
 * Every value here is derived from a real signal that already exists:
 *  - the enrolled reference image returned by AWS liveness/IndexFaces
 *  - the real AWS Rekognition landmark coordinates (or their absence)
 *  - the real protected-face rows registered in the database
 *  - the real face-protection stats (matches / confirmed threats)
 *
 * Nothing is timer-faked: a stage only completes when its backing signal
 * has actually resolved, and the scanner never turns red without a real
 * confirmed threat count.
 */

export type ShieldStageId =
  | "reference" // enrolled reference image available
  | "mesh" // AWS landmark mapping resolved (present or explicitly absent)
  | "registered" // protected face rows confirmed in the database
  | "status"; // protection status checked against real match/threat data

export const SHIELD_STAGES: { id: ShieldStageId; label: string }[] = [
  { id: "reference", label: "Building protected facial reference" },
  { id: "mesh", label: "Mapping facial characteristics" },
  { id: "registered", label: "Registering identity protection" },
  { id: "status", label: "Checking protection status" },
];

export type ShieldSignals = {
  /** Real enrolled reference image (data URL) returned by the enrollment flow. */
  hasReferenceImage: boolean;
  /** AWS landmark resolution finished (true even when AWS returned none). */
  meshResolved: boolean;
  /** Real protected_faces rows confirmed for this user. */
  protectedFaces: number | null;
  /** Real protection stats resolved from the backend. */
  statusChecked: boolean;
};

export function completedStages(s: ShieldSignals): ShieldStageId[] {
  const done: ShieldStageId[] = [];
  if (s.hasReferenceImage) done.push("reference");
  if (s.hasReferenceImage && s.meshResolved) done.push("mesh");
  if (done.includes("mesh") && (s.protectedFaces ?? 0) > 0) done.push("registered");
  if (done.includes("registered") && s.statusChecked) done.push("status");
  return done;
}

/** Progress is 25% per REAL completed milestone — never a fake timer. */
export function shieldProgress(s: ShieldSignals): number {
  return completedStages(s).length * 25;
}

export function isShieldComplete(s: ShieldSignals): boolean {
  return completedStages(s).length === SHIELD_STAGES.length;
}

export type ShieldThreatSignals = {
  /** Confirmed threats created from reviewed face matches. */
  confirmedThreats: number;
  /** Matches awaiting human review (checking / review state). */
  pendingReview: number;
};

export type ShieldTone = "cyan" | "amber" | "red" | "emerald";

/**
 * Red is reserved for real confirmed threats. Amber only when real matches are
 * awaiting review. Otherwise the shield stays cyan (scanning) / emerald (clear).
 */
export function shieldTone(
  s: ShieldSignals,
  threats: ShieldThreatSignals | null | undefined,
): ShieldTone {
  if (threats && threats.confirmedThreats > 0) return "red";
  if (threats && threats.pendingReview > 0) return "amber";
  return isShieldComplete(s) ? "emerald" : "cyan";
}

export function shieldStatusLine(
  s: ShieldSignals,
  threats: ShieldThreatSignals | null | undefined,
): { headline: string; detail: string } {
  if (!isShieldComplete(s)) {
    const next = SHIELD_STAGES[completedStages(s).length];
    return { headline: "BUILDING FACE SHIELD", detail: next?.label ?? "Working" };
  }
  if (threats && threats.confirmedThreats > 0) {
    return {
      headline: "ACTIVE THREAT REVIEW",
      detail: `${threats.confirmedThreats} confirmed misuse ${
        threats.confirmedThreats === 1 ? "case" : "cases"
      } linked to your protected face.`,
    };
  }
  if (threats && threats.pendingReview > 0) {
    return {
      headline: "FACE SHIELD ACTIVE · REVIEW PENDING",
      detail: `${threats.pendingReview} face ${
        threats.pendingReview === 1 ? "match" : "matches"
      } awaiting your review. No threat has been confirmed.`,
    };
  }
  return {
    headline: "FACE SHIELD ACTIVE",
    detail: "Your protected facial reference is ready for monitoring.",
  };
}
