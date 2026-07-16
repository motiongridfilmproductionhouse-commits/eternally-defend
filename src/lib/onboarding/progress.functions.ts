import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StepStatus = "NOT_STARTED" | "IN_PROGRESS" | "ACTION_REQUIRED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED" | "COMPLETED";

export const getProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("onboarding_progress").select("*").eq("user_id", userId).maybeSingle();
    if (!data) {
      const seed = { user_id: userId, current_step: 1, overall_status: "IN_PROGRESS" as const, step_states: {} };
      const { data: created } = await supabase.from("onboarding_progress").insert(seed).select().single();
      return created;
    }
    return data;
  });

export const setStepStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { step: number; status: StepStatus; advance?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cur } = await supabase.from("onboarding_progress").select("*").eq("user_id", userId).maybeSingle();
    const states = { ...((cur?.step_states as Record<string, StepStatus>) ?? {}), [String(data.step)]: data.status };
    const current_step = data.advance ? Math.max(cur?.current_step ?? 1, data.step + 1) : (cur?.current_step ?? data.step);
    const overall_status = data.step >= 10 && data.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS";
    const { data: up } = await supabase
      .from("onboarding_progress")
      .upsert({ user_id: userId, current_step, step_states: states, overall_status }, { onConflict: "user_id" })
      .select().single();
    return up;
  });
