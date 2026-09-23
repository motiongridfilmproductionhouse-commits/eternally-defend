/**
 * Pre-Enrollment Intelligence — client onboarding consumes the hand-off package.
 *
 * Flow:
 *   1. Staff "Begin Client Enrollment" creates one package per prospect scan
 *      (identity snapshot + prospect_scan_id) and records the selected,
 *      human-verified findings in prospect_enrollment_transfers.
 *   2. The package is linked to the client account either when the client
 *      redeems the package's invitation, or directly by an admin when the
 *      client already has an account.
 *   3. Applying the package (idempotent, safe to call repeatedly):
 *        - pre-fills empty onboarding profile fields, merges aliases / handles /
 *          known profile into the same fields the client's form edits, and keeps
 *          prospect_scan_id, known works and linked entities;
 *        - imports the transferred findings into client_prospect_findings with
 *          evidence references. That table is review-only: no scanner, report
 *          or enforcement path reads it, so nothing is enforced from a
 *          pre-enrollment scan.
 *
 * Every function here uses the service-role client and never throws into the
 * caller's user-facing flow unless explicitly awaited for a staff action.
 */

import {
  identitySnapshotOf,
  planFindingImports,
  planProfilePrefill,
  type IdentitySnapshot,
  type ImportEvidence,
  type ImportSourceFinding,
} from "./enrollment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function adminDb(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Db;
}

export interface PackageRow {
  id: string;
  scan_id: string;
  prospect_id: string;
  identity_snapshot: IdentitySnapshot;
  client_user_id: string | null;
  status: string;
  profile_prefilled_at: string | null;
}

/** Create (or return) the single package for a prospect scan. */
export async function ensurePackage(
  db: Db,
  input: { scanId: string; prospectId: string; accountType: string; createdBy: string },
): Promise<PackageRow> {
  const { data: identity, error } = await db
    .from("prospect_identities")
    .select("*")
    .eq("id", input.prospectId)
    .single();
  if (error || !identity) throw new Error("Prospect identity not found");
  const snapshot = identitySnapshotOf(identity);

  const { error: insertError } = await db.from("prospect_enrollment_packages").upsert(
    {
      scan_id: input.scanId,
      prospect_id: input.prospectId,
      identity_snapshot: snapshot,
      account_type: input.accountType,
      created_by: input.createdBy,
    },
    { onConflict: "scan_id", ignoreDuplicates: true },
  );
  if (insertError) throw new Error(`Could not create enrollment package: ${insertError.message}`);

  const { data: pkg, error: readError } = await db
    .from("prospect_enrollment_packages")
    .select("*")
    .eq("scan_id", input.scanId)
    .single();
  if (readError || !pkg) throw new Error("Enrollment package not readable");
  return pkg as PackageRow;
}

/** Link a package to a client account (first link wins; never re-pointed). */
export async function linkPackage(db: Db, packageId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("prospect_enrollment_packages")
    .update({ client_user_id: userId, status: "LINKED", linked_at: new Date().toISOString() })
    .eq("id", packageId)
    .is("client_user_id", null)
    .select("id");
  if (data?.length) return true;
  const { data: existing } = await db
    .from("prospect_enrollment_packages")
    .select("client_user_id")
    .eq("id", packageId)
    .maybeSingle();
  return existing?.client_user_id === userId;
}

/** Called after an invitation is redeemed: link any package issued with it. */
export async function linkPackageForRedeemedInvite(inviteId: string, userId: string) {
  try {
    const db = await adminDb();
    const { data: pkgs } = await db
      .from("prospect_enrollment_packages")
      .select("id")
      .eq("invite_id", inviteId);
    for (const p of pkgs ?? []) await linkPackage(db, p.id, userId);
    if (pkgs?.length) await applyPreEnrollmentPackagesForUser(userId);
  } catch (err) {
    console.error("[pre-enrollment] invite link failed", err);
  }
}

/**
 * Admin path for a client who already has an account: link by the email on
 * their onboarding profile. Returns the linked user id, or null when no
 * client account uses that email.
 */
export async function linkPackageToExistingClient(
  packageId: string,
  email: string,
): Promise<string | null> {
  const db = await adminDb();
  const { data: profile } = await db
    .from("client_profiles")
    .select("user_id")
    // Case-insensitive exact match: escape LIKE wildcards ("_" is common in emails).
    .ilike("email", email.trim().replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();
  if (!profile?.user_id) return null;
  const linked = await linkPackage(db, packageId, profile.user_id);
  if (!linked) throw new Error("This enrollment package is already linked to a different account.");
  await applyPreEnrollmentPackagesForUser(profile.user_id, db);
  return profile.user_id as string;
}

export interface ApplyOutcome {
  packages: number;
  profilePrefilled: number;
  findingsImported: number;
}

/**
 * Apply every package linked to this client. Idempotent: profile fields are
 * only filled when empty, the profile step runs once per package, and findings
 * are upserted on (client_user_id, prospect_finding_id).
 */
export async function applyPreEnrollmentPackagesForUser(
  userId: string,
  dbOverride?: Db,
): Promise<ApplyOutcome> {
  const db = dbOverride ?? (await adminDb());
  const outcome: ApplyOutcome = { packages: 0, profilePrefilled: 0, findingsImported: 0 };
  const { data: pkgs } = await db
    .from("prospect_enrollment_packages")
    .select("*")
    .eq("client_user_id", userId)
    .order("created_at", { ascending: true });
  for (const pkg of (pkgs ?? []) as PackageRow[]) {
    outcome.packages++;
    const now = new Date().toISOString();

    // 1. Onboarding profile pre-fill (only once the client's profile row exists).
    if (!pkg.profile_prefilled_at) {
      const { data: profile } = await db
        .from("client_profiles")
        .select(
          "display_name, company_name, country, website, onboarding_account_type, social_profiles",
        )
        .eq("user_id", userId)
        .maybeSingle();
      if (profile) {
        const update = planProfilePrefill(profile, pkg.identity_snapshot, {
          packageId: pkg.id,
          prospectScanId: pkg.scan_id,
        });
        const { error } = await db.from("client_profiles").update(update).eq("user_id", userId);
        if (!error) {
          await db
            .from("prospect_enrollment_packages")
            .update({ profile_prefilled_at: now })
            .eq("id", pkg.id)
            .is("profile_prefilled_at", null);
          outcome.profilePrefilled++;
        }
      }
    }

    // 2. Transferred, human-verified findings with evidence references.
    const { data: transfers } = await db
      .from("prospect_enrollment_transfers")
      .select("finding_id, target_table")
      .eq("scan_id", pkg.scan_id)
      .eq("target_table", "enrollment_finding");
    const findingIds = (transfers ?? [])
      .map((t: { finding_id: string | null }) => t.finding_id)
      .filter(Boolean) as string[];
    if (findingIds.length) {
      const [{ data: findings }, { data: evidence }, { data: imported }] = await Promise.all([
        db
          .from("prospect_findings")
          .select(
            "id, scan_id, state, stage_key, category, severity, detection_reason, confidence, verified_by, verified_at, discovery:prospect_discoveries(original_url, canonical_url, platform, title, discovery_method, identity_bucket, identity_confidence)",
          )
          .in("id", findingIds),
        db
          .from("prospect_finding_evidence")
          .select(
            "id, finding_id, source_url, capture_path, capture_kind, content_hash, observed_at",
          )
          .in("finding_id", findingIds),
        db
          .from("client_prospect_findings")
          .select("prospect_finding_id")
          .eq("client_user_id", userId)
          .in("prospect_finding_id", findingIds),
      ]);
      const rows = planFindingImports({
        clientUserId: userId,
        packageId: pkg.id,
        transferredFindingIds: findingIds,
        findings: (findings ?? []) as ImportSourceFinding[],
        evidence: (evidence ?? []) as ImportEvidence[],
        alreadyImported: (imported ?? []).map(
          (r: { prospect_finding_id: string }) => r.prospect_finding_id,
        ),
      });
      if (rows.length) {
        const { data: inserted, error } = await db
          .from("client_prospect_findings")
          .upsert(rows, {
            onConflict: "client_user_id,prospect_finding_id",
            ignoreDuplicates: true,
          })
          .select("id, prospect_finding_id");
        if (error) throw new Error(`Could not import pre-enrollment findings: ${error.message}`);
        outcome.findingsImported += inserted?.length ?? 0;
        for (const r of inserted ?? []) {
          await db
            .from("prospect_enrollment_transfers")
            .update({ target_id: r.id, target_user_id: userId })
            .eq("scan_id", pkg.scan_id)
            .eq("target_table", "enrollment_finding")
            .eq("finding_id", r.prospect_finding_id);
        }
      }
    }

    // 3. Mark identity transfer + package state.
    await db
      .from("prospect_enrollment_transfers")
      .update({ target_user_id: userId, target_id: pkg.id })
      .eq("scan_id", pkg.scan_id)
      .eq("target_table", "enrollment_identity")
      .is("target_user_id", null);
    const { count } = await db
      .from("client_prospect_findings")
      .select("id", { count: "exact", head: true })
      .eq("package_id", pkg.id);
    const { data: fresh } = await db
      .from("prospect_enrollment_packages")
      .select("profile_prefilled_at, applied_at")
      .eq("id", pkg.id)
      .single();
    await db
      .from("prospect_enrollment_packages")
      .update({
        findings_imported: count ?? 0,
        status: fresh?.profile_prefilled_at ? "APPLIED" : "LINKED",
        applied_at: fresh?.applied_at ?? (fresh?.profile_prefilled_at ? now : null),
      })
      .eq("id", pkg.id);
  }
  return outcome;
}

/** Best-effort wrapper for onboarding hooks: never breaks the client's flow. */
export async function applyPreEnrollmentPackagesSafely(userId: string): Promise<void> {
  try {
    await applyPreEnrollmentPackagesForUser(userId);
  } catch (err) {
    console.error("[pre-enrollment] apply failed", err);
  }
}
