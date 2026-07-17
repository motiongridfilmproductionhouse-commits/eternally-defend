import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StepStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "ACTION_REQUIRED"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "COMPLETED";

export const getProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to load onboarding progress: ${error.message}`);
    }

    if (!data) {
      const seed = {
        user_id: userId,
        current_step: 1,
        overall_status: "IN_PROGRESS" as const,
        step_states: {},
      };

      const { data: created, error: createError } = await supabase
        .from("onboarding_progress")
        .insert(seed)
        .select()
        .single();

      if (createError) {
        throw new Error(
          `Unable to create onboarding progress: ${createError.message}`,
        );
      }

      return created;
    }

    return data;
  });

export const setStepStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { step: number; status: StepStatus; advance?: boolean }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: current, error: readError } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) {
      throw new Error(
        `Unable to read onboarding progress: ${readError.message}`,
      );
    }

    const states = {
      ...((current?.step_states as Record<string, StepStatus>) ?? {}),
      [String(data.step)]: data.status,
    };

    const currentStep = data.advance
      ? Math.max(current?.current_step ?? 1, data.step + 1)
      : current?.current_step ?? data.step;

    const overallStatus =
      data.step >= 9 && data.status === "COMPLETED"
        ? "COMPLETED"
        : "IN_PROGRESS";

    const { data: updated, error: updateError } = await supabase
      .from("onboarding_progress")
      .upsert(
        {
          user_id: userId,
          current_step: currentStep,
          step_states: states,
          overall_status: overallStatus,
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();

    if (updateError) {
      throw new Error(
        `Unable to update onboarding progress: ${updateError.message}`,
      );
    }

    if (!updated) {
      throw new Error("Onboarding progress update returned no record.");
    }

    return updated;
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    
    // Set onboarding_completed = true in client_profiles
    const { error: profileError } = await supabase
      .from("client_profiles")
      .update({ onboarding_completed: true } as any)
      .eq("user_id", userId);
      
    if (profileError) {
      throw new Error(`Failed to complete onboarding profile: ${profileError.message}`);
    }

    // Set overall_status = 'COMPLETED' and mark step 9 as completed in onboarding_progress
    const { data: progress } = await supabase.from("onboarding_progress").select("*").eq("user_id", userId).maybeSingle();
    const states = {
      ...(progress?.step_states as Record<string, string> ?? {}),
      "9": "COMPLETED"
    };

    const { error: progressError } = await supabase
      .from("onboarding_progress")
      .update({ 
        current_step: 10,
        step_states: states,
        overall_status: "COMPLETED" 
      })
      .eq("user_id", userId);

    if (progressError) {
      throw new Error(`Failed to update onboarding progress: ${progressError.message}`);
    }

    return { ok: true };
  });
