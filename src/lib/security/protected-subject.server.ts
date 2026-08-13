import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAuthorizedIdentity,
  resolveScanTarget,
  type AuthorizedIdentity,
} from "./subject-authorization";

export {
  SubjectAuthorizationError,
  SUBJECT_ASSOCIATION_UNVERIFIED,
  assertEnforcementAuthorized,
  isAuthorizedSubjectName,
} from "./subject-authorization";
export type { AuthorizedIdentity } from "./subject-authorization";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, "public", any>;

/**
 * Resolves the authenticated workspace's registered protected subject from
 * onboarding data (client_profiles) + authorized assets (protected_assets).
 */
export async function resolveProtectedIdentity(
  supabase: AnyClient,
  userId: string,
  email?: string | null,
): Promise<AuthorizedIdentity> {
  const [profileRes, assetsRes] = await Promise.all([
    supabase
      .from("client_profiles")
      .select(
        "account_type, onboarding_account_type, client_type, email, legal_name, full_name, display_name, company_name, company_brand_name, website, official_socials, social_profiles",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("protected_assets").select("name, kind, source_url, active").eq("user_id", userId),
  ]);

  return buildAuthorizedIdentity(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profileRes.data ?? null) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((assetsRes.data ?? []) as any[]) ?? [],
    { email },
  );
}

/**
 * Single authoritative gate for every scan/discovery/monitoring entry point.
 * Returns the server-derived target; throws when the client tries to swap subjects.
 */
export async function enforceScanSubject(
  ctx: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: AnyClient;
    userId: string;
    claims?: { email?: string } | Record<string, unknown>;
  },
  requested?: { targetName?: string | null; aliases?: string[] | null },
): Promise<{ targetName: string; aliases: string[]; unrestricted: boolean; identity: AuthorizedIdentity }> {
  const email = (ctx.claims as { email?: string } | undefined)?.email ?? null;
  const identity = await resolveProtectedIdentity(ctx.supabase, ctx.userId, email);
  const resolved = resolveScanTarget(identity, requested);
  if (!resolved.unrestricted) {
    console.info("[SUBJECT-GUARD]", {
      userId: ctx.userId,
      requested: requested?.targetName ?? null,
      enforced: resolved.targetName,
    });
  }
  return { ...resolved, identity };
}

/** Ownership check for any client-supplied row id. */
export async function assertOwnedRow(
  supabase: AnyClient,
  table: string,
  id: string,
  userId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { SubjectAuthorizationError } = await import("./subject-authorization");
    throw new SubjectAuthorizationError(`Not authorized: ${table} record does not belong to this workspace.`);
  }
}
