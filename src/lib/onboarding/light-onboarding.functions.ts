import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { finishLightOnboardingForUser } from "./light-onboarding.server";

/**
 * Completes friction-light onboarding (celebrity / public figure and
 * representative routes). Grants monitoring access only — never a verification
 * badge, and never an authorized enforcement state.
 */
export const finishLightOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => finishLightOnboardingForUser(context.supabase, context.userId));
