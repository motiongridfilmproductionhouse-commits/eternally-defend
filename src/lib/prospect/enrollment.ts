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

/* ------------------------------------------------------------------------ */
/* Consumption by client onboarding (pure planning; the server applies it).  */
/* ------------------------------------------------------------------------ */

/** Onboarding v2 account type suggested by the prospect identity type. */
export function accountTypeForIdentity(identityType: string | null | undefined): string {
  switch ((identityType ?? "").toLowerCase()) {
    case "brand":
    case "company":
    case "organization":
      return "enterprise";
    case "individual":
    case "executive":
      return "individual";
    default:
      return "celebrity"; // celebrity / public_figure
  }
}

export interface IdentitySnapshot {
  prospect_id: string;
  display_name: string;
  identity_type: string;
  country_region: string | null;
  profession: string | null;
  organization: string | null;
  known_profile_url: string | null;
  known_website: string | null;
  aliases: string[];
  known_handles: string[];
  known_works: string[];
  linked_entities: string[];
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) =>
      typeof x === "string"
        ? x
        : x && typeof x === "object" && "handle" in x
          ? String((x as { handle: unknown }).handle)
          : "",
    )
    .map((x) => x.trim())
    .filter(Boolean);
}

function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function identitySnapshotOf(identity: Record<string, unknown>): IdentitySnapshot {
  return {
    prospect_id: String(identity.id),
    display_name: String(identity.display_name ?? "").trim(),
    identity_type: String(identity.identity_type ?? "individual"),
    country_region: textOrNull(identity.country_region),
    profession: textOrNull(identity.profession),
    organization: textOrNull(identity.organization),
    known_profile_url: textOrNull(identity.known_profile_url),
    known_website: textOrNull(identity.known_website),
    aliases: strings(identity.aliases),
    known_handles: strings(identity.known_handles),
    known_works: strings(identity.known_works),
    linked_entities: strings(identity.linked_entities),
  };
}

function union(a: string[], b: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...a, ...b]) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
    if (out.length >= max) break;
  }
  return out;
}

export interface ProfileLikeRow {
  display_name?: string | null;
  company_name?: string | null;
  country?: string | null;
  website?: string | null;
  onboarding_account_type?: string | null;
  social_profiles?: unknown;
}

/**
 * Pre-fill the client's own onboarding profile from the verified prospect
 * identity. Never overwrites a value the client already entered; aliases and
 * handles are merged into the same `social_profiles` keys the onboarding
 * form edits, so the client sees and confirms them. The pre-enrollment block
 * keeps prospect_scan_id plus known works / linked entities (no dedicated
 * columns exist for those) for downstream protection setup.
 */
export function planProfilePrefill(
  profile: ProfileLikeRow,
  snap: IdentitySnapshot,
  refs: { packageId: string; prospectScanId: string },
): Record<string, unknown> {
  const social = (
    profile.social_profiles && typeof profile.social_profiles === "object"
      ? profile.social_profiles
      : {}
  ) as Record<string, unknown>;
  const isOrg = accountTypeForIdentity(snap.identity_type) === "enterprise";
  const update: Record<string, unknown> = {};
  if (!textOrNull(profile.display_name) && snap.display_name)
    update.display_name = snap.display_name;
  if (!textOrNull(profile.country) && snap.country_region) update.country = snap.country_region;
  if (!textOrNull(profile.website) && snap.known_website) update.website = snap.known_website;
  const company = isOrg ? snap.display_name : snap.organization;
  if (!textOrNull(profile.company_name) && company) update.company_name = company;

  const existingLinks = Array.isArray(social.links)
    ? (social.links as Array<{ url?: string }>)
    : [];
  const links = [...existingLinks];
  if (snap.known_profile_url && !links.some((l) => l?.url === snap.known_profile_url)) {
    links.push({
      url: snap.known_profile_url,
      platform: "other",
      label: "Known profile (pre-enrollment)",
    } as never);
  }

  update.social_profiles = {
    ...social,
    aliases: union(strings(social.aliases), snap.aliases, 20),
    handles: union(strings(social.handles), snap.known_handles, 30),
    ...(links.length ? { links } : {}),
    pre_enrollment: {
      package_id: refs.packageId,
      prospect_scan_id: refs.prospectScanId,
      prospect_id: snap.prospect_id,
      known_works: snap.known_works,
      linked_entities: snap.linked_entities,
      profession: snap.profession,
    },
  };
  return update;
}

export interface ImportSourceFinding {
  id: string;
  scan_id: string;
  state: string;
  stage_key: string;
  category: string;
  severity: string | null;
  detection_reason: string;
  confidence: number | null;
  verified_by: string | null;
  verified_at: string | null;
  discovery: {
    original_url: string;
    canonical_url: string | null;
    platform: string | null;
    title: string | null;
    discovery_method: string | null;
    identity_bucket: string;
    identity_confidence: number | null;
  } | null;
}

export interface ImportEvidence {
  id: string;
  finding_id: string;
  source_url: string;
  capture_path: string | null;
  capture_kind: string | null;
  content_hash: string | null;
  observed_at: string;
}

/**
 * Rows for `client_prospect_findings` — review-only copies of the transferred,
 * human-verified findings with references (not copies) of their evidence.
 * Already-imported findings are skipped so a repeat hand-off never duplicates.
 */
export function planFindingImports(input: {
  clientUserId: string;
  packageId: string;
  transferredFindingIds: string[];
  findings: ImportSourceFinding[];
  evidence: ImportEvidence[];
  alreadyImported: string[];
}): Array<Record<string, unknown>> {
  const done = new Set(input.alreadyImported);
  const wanted = new Set(input.transferredFindingIds);
  const evidenceBy = new Map<string, ImportEvidence[]>();
  for (const e of input.evidence) {
    const list = evidenceBy.get(e.finding_id) ?? [];
    list.push(e);
    evidenceBy.set(e.finding_id, list);
  }
  return input.findings
    .filter(
      (f) =>
        wanted.has(f.id) &&
        !done.has(f.id) &&
        (f.state === "VERIFIED" || f.state === "ESCALATED") &&
        f.discovery?.identity_bucket === "MATCHED",
    )
    .map((f) => ({
      package_id: input.packageId,
      client_user_id: input.clientUserId,
      prospect_scan_id: f.scan_id,
      prospect_finding_id: f.id,
      stage_key: f.stage_key,
      category: f.category,
      severity: f.severity,
      detection_reason: f.detection_reason,
      confidence: f.confidence,
      source_url: f.discovery!.original_url,
      canonical_url: f.discovery!.canonical_url,
      platform: f.discovery!.platform,
      title: f.discovery!.title,
      discovery_method: f.discovery!.discovery_method,
      identity_confidence: f.discovery!.identity_confidence,
      finding_state: f.state,
      verified_by: f.verified_by,
      verified_at: f.verified_at,
      evidence_refs: (evidenceBy.get(f.id) ?? []).map((e) => ({
        evidence_id: e.id,
        source_url: e.source_url,
        capture_path: e.capture_path,
        capture_kind: e.capture_kind,
        content_hash: e.content_hash,
        observed_at: e.observed_at,
      })),
    }));
}
