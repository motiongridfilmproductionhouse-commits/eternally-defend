/**
 * Enrolls a customer into every scan module they're eligible for, based on
 * their granted authorization scopes. Idempotent: re-running never resets an
 * already-running enrollment's counters/status, and never duplicates jobs —
 * it's safe to call on every authorization activation and from the backfill.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  MODULE_REGISTRY,
  computeEnrollmentPatch,
  type ExistingEnrollmentRow,
} from "./module-registry";

export async function enrollEligibleModules(userId: string, profileId: string): Promise<void> {
  // scan_module_enrollments is a new table not yet reflected in the
  // generated Database type until the migration is applied and types are
  // regenerated — cast, matching this codebase's existing convention for
  // tables ahead of codegen (see src/lib/enforcement/worker.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data: auth } = await db
    .from("client_authorizations")
    .select("id, status")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!auth) return;

  const { data: scopes } = await db
    .from("authorization_scopes")
    .select("scope_key, granted")
    .eq("authorization_id", auth.id);
  const grantedScopes = new Set<string>(
    (scopes ?? [])
      .filter((s: { granted?: boolean }) => s.granted)
      .map((s: { scope_key: string }) => s.scope_key),
  );

  const { data: existingRows } = await db
    .from("scan_module_enrollments")
    .select("module_key, eligible")
    .eq("user_id", userId);
  const existingByKey = new Map<string, ExistingEnrollmentRow>(
    (existingRows ?? []).map((r: ExistingEnrollmentRow) => [r.module_key, r]),
  );

  const authActive = auth.status === "ACTIVE";
  const now = new Date().toISOString();

  for (const mod of MODULE_REGISTRY) {
    const existing = existingByKey.get(mod.key);
    const patch = {
      ...computeEnrollmentPatch(mod, authActive, grantedScopes, existing, now),
      user_id: userId,
      profile_id: profileId,
    };
    await db.from("scan_module_enrollments").upsert(patch, { onConflict: "user_id,module_key" });
  }
}
