/**
 * Pre-Enrollment Intelligence — client onboarding consumes the hand-off package.
 *
 * No service-role credential. Every call runs under the caller's own RLS
 * session; the few steps that cross the staff/client boundary are
 * SECURITY DEFINER database functions that check auth.uid() themselves
 * (see migration 20260924120000_prospect_without_service_role.sql):
 *
 *   staff  → ensurePackage (staff RLS insert), prospect_link_package_to_client_email
 *            (admin staff), prospect_import_package_findings (staff)
 *   client → prospect_claim_my_packages (links packages from an invitation the
 *            caller redeemed), own client_profiles pre-fill (client RLS),
 *            prospect_mark_my_package_prefilled, prospect_import_my_findings
 *
 * Imported findings land in the review-only client_prospect_findings table:
 * no scanner, report or enforcement path reads it.
 */

import { identitySnapshotOf, planProfilePrefill, type IdentitySnapshot } from "./enrollment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface PackageRow {
  id: string;
  scan_id: string;
  prospect_id: string;
  identity_snapshot: IdentitySnapshot;
  client_user_id: string | null;
  status: string;
  profile_prefilled_at: string | null;
}

/** Staff: create (or return) the single package for a prospect scan. */
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

/** Staff admin: deliver to a client who already has an account (by profile email). */
export async function linkPackageToExistingClient(
  db: Db,
  packageId: string,
  email: string,
): Promise<string | null> {
  const { data, error } = await db.rpc("prospect_link_package_to_client_email", {
    _package_id: packageId,
    _email: email,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** Staff: push newly selected findings to an already-linked client. */
export async function importPackageFindings(db: Db, packageId: string): Promise<number> {
  const { data, error } = await db.rpc("prospect_import_package_findings", {
    _package_id: packageId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface ApplyOutcome {
  packages: number;
  profilePrefilled: number;
  findingsImported: number;
}

/**
 * Client: claim, pre-fill and import — idempotent, safe on every onboarding
 * load. Profile fields are only filled when empty; findings are unique per
 * (client, prospect finding).
 */
export async function applyMyPreEnrollmentPackages(db: Db, userId: string): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { packages: 0, profilePrefilled: 0, findingsImported: 0 };
  const { data: pkgs, error } = await db.rpc("prospect_claim_my_packages");
  if (error) throw new Error(error.message);
  const packages = (pkgs ?? []) as Array<{
    id: string;
    scan_id: string;
    identity_snapshot: IdentitySnapshot;
    profile_prefilled_at: string | null;
  }>;
  outcome.packages = packages.length;
  if (!packages.length) return outcome;

  for (const pkg of packages) {
    if (pkg.profile_prefilled_at) continue;
    // Pre-fill happens once the client's onboarding profile row exists.
    const { data: profile } = await db
      .from("client_profiles")
      .select(
        "display_name, company_name, country, website, onboarding_account_type, social_profiles",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile) continue;
    const update = planProfilePrefill(profile, pkg.identity_snapshot, {
      packageId: pkg.id,
      prospectScanId: pkg.scan_id,
    });
    const { error: updateError } = await db
      .from("client_profiles")
      .update(update)
      .eq("user_id", userId);
    if (updateError) continue;
    const { data: marked } = await db.rpc("prospect_mark_my_package_prefilled", {
      _package_id: pkg.id,
    });
    if (marked) outcome.profilePrefilled++;
  }

  const { data: imported, error: importError } = await db.rpc("prospect_import_my_findings");
  if (importError) throw new Error(importError.message);
  outcome.findingsImported = Number(imported ?? 0);
  return outcome;
}

/** Best-effort wrapper for onboarding hooks: never breaks the client's flow. */
export async function applyMyPreEnrollmentPackagesSafely(db: Db, userId: string): Promise<void> {
  try {
    await applyMyPreEnrollmentPackages(db, userId);
  } catch (err) {
    console.error("[pre-enrollment] apply failed", err instanceof Error ? err.message : err);
  }
}
