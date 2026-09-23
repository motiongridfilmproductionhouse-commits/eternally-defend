/**
 * Pre-Enrollment Intelligence — enrollment hand-off planning (pure).
 *
 * Only human-VERIFIED (or ESCALATED) findings on identity-MATCHED items may be
 * carried into client onboarding. Repeat hand-offs are idempotent: anything
 * already transferred for this prospect_scan_id is skipped, never duplicated.
 */

export interface TransferFinding {
  id: string;
  discovery_id: string;
  state: string;
}

export interface TransferPlan {
  toTransfer: string[];
  alreadyTransferred: string[];
  rejected: string[];
  includeIdentity: boolean;
  identityAlreadyPackaged: boolean;
}

export function planEnrollmentTransfer(input: {
  selectedIds: string[];
  findings: TransferFinding[];
  discoveries: Array<{ id: string; identity_bucket: string }>;
  existing: Array<{ finding_id: string | null; target_table: string }>;
}): TransferPlan {
  const byId = new Map(input.findings.map((f) => [f.id, f]));
  const bucket = new Map(input.discoveries.map((d) => [d.id, d.identity_bucket]));
  const done = new Set(
    input.existing
      .filter((e) => e.target_table === "enrollment_finding" && e.finding_id)
      .map((e) => e.finding_id as string),
  );
  const identityAlreadyPackaged = input.existing.some(
    (e) => e.target_table === "enrollment_identity",
  );

  const toTransfer: string[] = [];
  const alreadyTransferred: string[] = [];
  const rejected: string[] = [];
  for (const id of Array.from(new Set(input.selectedIds))) {
    const f = byId.get(id);
    const eligible =
      f &&
      (f.state === "VERIFIED" || f.state === "ESCALATED") &&
      bucket.get(f.discovery_id) === "MATCHED";
    if (!eligible) rejected.push(id);
    else if (done.has(id)) alreadyTransferred.push(id);
    else toTransfer.push(id);
  }
  return {
    toTransfer,
    alreadyTransferred,
    rejected,
    includeIdentity: !identityAlreadyPackaged,
    identityAlreadyPackaged,
  };
}
