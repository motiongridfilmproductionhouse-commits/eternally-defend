import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MODULE_REGISTRY, type ScanModuleEnrollment } from "./module-registry";
import { effectiveProtectionStatus } from "./profile.server";

export const getProtectionEnrollments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const [{ data: profile }, { data: enrollments }] = await Promise.all([
      supabase.from("protection_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("scan_module_enrollments").select("*").eq("user_id", userId),
    ]);
    const byKey = new Map<string, ScanModuleEnrollment>(
      (enrollments ?? []).map((e: ScanModuleEnrollment) => [e.module_key, e]),
    );
    const modules = MODULE_REGISTRY.map((m) => ({
      key: m.key,
      label: m.label,
      driver: m.driver,
      enrollment: byKey.get(m.key) ?? null,
    }));
    const effectiveProfile = profile
      ? { ...profile, protection_status: effectiveProtectionStatus(profile) }
      : null;
    return { profile: effectiveProfile, modules };
  });
