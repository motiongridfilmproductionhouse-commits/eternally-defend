/**
 * Protection Autopilot — owner-scoped server functions.
 * Every read/write runs as the signed-in account, so RLS keeps tenants isolated.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getProtectionAutopilot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: profile }, { data: targets }, { data: runs }, { data: seen }] =
      await Promise.all([
        supabase.from("protection_profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase
          .from("protection_targets")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: true }),
        supabase
          .from("protection_runs")
          .select("*")
          .eq("user_id", userId)
          .order("started_at", { ascending: false })
          .limit(20),
        supabase
          .from("protection_findings_seen")
          .select("*")
          .eq("user_id", userId)
          .order("last_seen_at", { ascending: false })
          .limit(100),
      ]);
    const { enforcementSwitches } = await import("./autopilot");
    return {
      profile: profile ?? null,
      targets: targets ?? [],
      runs: runs ?? [],
      findings: seen ?? [],
      switches: enforcementSwitches(),
    };
  });

export const activateProtection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context as any;
    const { activateProtectionAutopilot } = await import("./autopilot.server");
    return activateProtectionAutopilot(supabase, userId, { email: claims?.email ?? null });
  });

export const runProtectionTargetNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ targetId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: target } = await supabase
      .from("protection_targets")
      .select("*")
      .eq("id", data.targetId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!target) throw new Error("Protection target not found for this account.");
    const { runProtectionTarget } = await import("./autopilot.server");
    return runProtectionTarget(supabase, target, "manual");
  });

export const setProtectionPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ paused: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("protection_profiles")
      .update({ paused: data.paused, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, paused: data.paused };
  });
