/**
 * Pure categorisation for a REAL protected-face match.
 *
 * Hard rule: face similarity is only an identity-linking signal. It may never
 * on its own produce defamation, deepfake, impersonation, fake endorsement or
 * copyright verdicts. Those categories are only assigned when the EXISTING
 * pipelines (deepfake verification, reputation evidence classifier,
 * impersonation account discovery) already recorded a qualifying finding for
 * the same source.
 */

export type FaceLinkedCategory =
  | "NORMAL_MENTION"
  | "NEEDS_REVIEW"
  | "REPUTATION_RISK"
  | "DEEPFAKE_MEDIA"
  | "IMPERSONATION";

export type FaceLinkedSeverity = "Info" | "Low" | "Medium" | "High" | "Critical";

/** Signals taken verbatim from the existing tables — never invented here. */
export type FaceLinkedSignals = {
  /** Rekognition similarity (identity link only). */
  similarity: number | null;
  /** scan_hits row for the same source, when the match came from a scan hit. */
  hit?: {
    severity?: string | null;
    risk_type?: string | null;
    tags?: string[] | null;
    threat_score?: number | null;
  } | null;
  /** Existing deepfake_findings row for the same URL, if the pipeline made one. */
  deepfake?: {
    is_synthetic?: boolean | null;
    risk_level?: string | null;
    confidence?: number | null;
    review_status?: string | null;
    finding_classification?: string | null;
  } | null;
  /** Existing discovered_accounts / impersonation evidence for the same URL. */
  impersonation?: {
    status?: string | null;
    confidence?: number | null;
  } | null;
  /** Campaign-authorised surface (approved account / official url / media). */
  authorized?: boolean;
};

const HARM_TERMS = [
  "defamation",
  "defamatory",
  "harassment",
  "hate",
  "false claim",
  "false-claim",
  "misinformation",
  "fake news",
  "scandal",
  "allegation",
  "abuse",
  "obscene",
  "leak",
];

const AMBIGUOUS_TERMS = ["unverified", "rumor", "rumour", "speculation", "clickbait"];

function bag(hit: FaceLinkedSignals["hit"]): string[] {
  if (!hit) return [];
  return [String(hit.risk_type ?? "").toLowerCase(), ...(hit.tags ?? []).map((t) => String(t).toLowerCase())];
}

function hasTerm(terms: string[], values: string[]): boolean {
  return values.some((v) => terms.some((t) => v.includes(t)));
}

export type FaceLinkedVerdict = {
  category: FaceLinkedCategory;
  severity: FaceLinkedSeverity;
  /** Review workflow status persisted on face_match_events. */
  reviewStatus: "pending" | "confirmed";
  /** Machine-readable reason for the audit trail. */
  reason: string;
};

/**
 * Decides what a real face match means, using only existing pipeline evidence.
 */
export function classifyFaceLinkedFinding(signals: FaceLinkedSignals): FaceLinkedVerdict {
  if (signals.authorized) {
    return {
      category: "NORMAL_MENTION",
      severity: "Info",
      reviewStatus: "confirmed",
      reason: "campaign_authorized_surface",
    };
  }

  const df = signals.deepfake;
  if (df && df.is_synthetic === true && (df.confidence ?? 0) >= 70) {
    const risk = String(df.risk_level ?? "").toLowerCase();
    return {
      category: "DEEPFAKE_MEDIA",
      severity: risk === "critical" ? "Critical" : risk === "high" ? "Critical" : "High",
      reviewStatus: df.review_status === "confirmed" ? "confirmed" : "pending",
      reason: "existing_deepfake_finding",
    };
  }

  const imp = signals.impersonation;
  if (imp && (imp.status ?? "").toLowerCase() === "confirmed") {
    return {
      category: "IMPERSONATION",
      severity: "High",
      reviewStatus: "confirmed",
      reason: "existing_confirmed_impersonation",
    };
  }

  const values = bag(signals.hit);
  const sev = String(signals.hit?.severity ?? "").toLowerCase();
  const score = Number(signals.hit?.threat_score ?? 0);

  if (hasTerm(HARM_TERMS, values) && (sev === "high" || sev === "critical" || score >= 60)) {
    return {
      category: "REPUTATION_RISK",
      severity: sev === "critical" || score >= 80 ? "Critical" : "High",
      reviewStatus: "pending",
      reason: "existing_reputation_evidence",
    };
  }

  if (
    hasTerm(HARM_TERMS, values) ||
    hasTerm(AMBIGUOUS_TERMS, values) ||
    (df && df.is_synthetic === true) ||
    (imp && (imp.status ?? "").toLowerCase() === "pending") ||
    sev === "medium" ||
    (signals.similarity !== null && signals.similarity < 90)
  ) {
    return {
      category: "NEEDS_REVIEW",
      severity: "Medium",
      reviewStatus: "pending",
      reason: "unclear_context_or_authorization",
    };
  }

  return {
    category: "NORMAL_MENTION",
    severity: "Low",
    reviewStatus: "pending",
    reason: "public_appearance_no_harmful_evidence",
  };
}

/** Radar colour band derived strictly from the verdict. */
export function radarSeverityForCategory(v: FaceLinkedVerdict): FaceLinkedSeverity {
  return v.severity;
}
