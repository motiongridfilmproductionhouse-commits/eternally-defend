import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeArtist, validateProfile } from "./policy";
import type { Assessment } from "./model";
const idSchema = z.object({ id: z.string().uuid() }).strict();
const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

export const agentAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Access is decided with the caller's own RLS-scoped session, so sign-in never
    // depends on privileged backend credentials being present in the runtime.
    const { accessWithClient } = await import("./assessment.server");
    const { assertAgentAccess } = await import("./policy");
    const role = await accessWithClient(context.supabase, context.userId);
    assertAgentAccess(context.userId, role.active, role.admin);
    return role;
  });
export const createAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { artist_name: string; official_profile_url?: string }) => {
    const parsed = z
      .object({ artist_name: z.string(), official_profile_url: z.string().optional() })
      .strict()
      .parse(input);
    return {
      artist_name: normalizeArtist(parsed.artist_name),
      official_profile_url: validateProfile(parsed.official_profile_url),
    };
  })
  .handler(async ({ data, context }) => {
    const { db, requireAgent, hashReference, runAssessment } = await import("./assessment.server");
    await requireAgent(context.userId);
    const { data: id, error } = await db.rpc("agent_create_assessment", {
      p_actor: context.userId,
      p_name: data.artist_name,
      p_url: data.official_profile_url,
      p_key: hashReference(
        data.artist_name.toLocaleLowerCase("en") + "\n" + (data.official_profile_url ?? ""),
      ),
    });
    if (error)
      throw new Error(
        error.message.includes("limit reached")
          ? "Assessment limit reached. Please try again later."
          : "Could not create assessment.",
      );
    const { registerWaitUntilExecution } = await import("@/lib/deepfake/startup-network.server");
    const work = runAssessment(id).catch(() =>
      console.error("[agent] assessment execution failed", id),
    );
    // Nitro attaches Cloudflare's request lifetime hook; Vercel uses the existing helper.
    const request = getRequest() as Request & { waitUntil?: (promise: Promise<unknown>) => void };
    if (request.waitUntil) request.waitUntil(work);
    else registerWaitUntilExecution(work);
    return { id: id as string };
  });
export const listAssessments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, requireAgent, publicColumns } = await import("./assessment.server");
    const { role } = await requireAgent(context.userId);
    let query = db
      .from("agent_assessments")
      .select(publicColumns)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!role.admin) query = query.eq("agent_id", context.userId);
    const { data, error } = await query;
    if (error) throw new Error("Could not load assessments.");
    return (data ?? []) as Assessment[];
  });
export const getAssessment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { db, requireAgent } = await import("./assessment.server");
    const { assessment } = await requireAgent(context.userId, data.id);
    if (!assessment) throw new Error("Assessment not found");
    if (
      ["QUEUED", "SCANNING", "ANALYZING"].includes(assessment.status) &&
      Date.parse(assessment.updated_at) < Date.now() - 180000
    ) {
      const { error } = await db
        .from("agent_assessments")
        .update({
          status: "FAILED",
          pricing: null,
          stage: "Scan interrupted",
          reason: "Scan interrupted. Please try again.",
        })
        .eq("id", data.id)
        .eq("updated_at", assessment.updated_at);
      if (error) throw new Error("Unable to update scan status.");
      return (await requireAgent(context.userId, data.id)).assessment!;
    }
    return assessment;
  });
export const assessmentDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; decision: "INTERESTED" | "DECLINED" | "SAVED" | "VIEWED" }) =>
      idSchema
        .extend({ decision: z.enum(["INTERESTED", "DECLINED", "SAVED", "VIEWED"]) })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, requireAgent, audit, newReference, hashReference } =
      await import("./assessment.server");
    const { assessment } = await requireAgent(context.userId, data.id);
    if (!assessment || !["READY", "REVIEW_REQUIRED"].includes(assessment.status))
      throw new Error("Assessment is not complete.");
    await audit(context.userId, data.decision, data.id);
    if (data.decision === "SAVED") return { redirect_url: null };
    if (data.decision === "INTERESTED" && assessment.status !== "READY")
      throw new Error("Eterna review is required before proceeding.");
    const { data: updated, error } = await db
      .from("agent_assessments")
      .update({ conversion_status: data.decision })
      .eq("id", data.id)
      .is("client_user_id", null)
      .in(
        "conversion_status",
        data.decision === "VIEWED"
          ? ["SCANNED"]
          : ["SCANNED", "VIEWED", "INTERESTED", "LOGIN_STARTED", "DECLINED"],
      )
      .select("id")
      .maybeSingle();
    if (error) throw new Error("Could not save decision.");
    if (data.decision !== "INTERESTED") return { redirect_url: null };
    if (!updated) throw new Error("This assessment is already linked to a client.");
    const token = newReference();
    const { error: tokenError } = await db.from("agent_assessment_handoffs").upsert({
      assessment_id: data.id,
      token_hash: hashReference(token),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      claimed_by: null,
      claimed_at: null,
    });
    if (tokenError) throw new Error("Could not create secure handoff.");
    return { redirect_url: `/auth?assessment=${token}` };
  });
export const previewAssessment = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => tokenSchema.parse(input))
  .handler(async ({ data }) => {
    const { inviteAttemptsBlocked, recordInviteAttempt } =
      await import("@/lib/invites/invites.server");
    const key =
      "assessment:" + (getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown");
    if (await inviteAttemptsBlocked(key))
      throw new Error("Too many attempts. Please try again later.");
    // Count all reference lookups, including successful requests.
    await recordInviteAttempt(key, null, false);
    const { db, resolveReference } = await import("./assessment.server");
    const handoff = await resolveReference(data.token);
    const { error } = await db
      .from("agent_assessments")
      .update({ conversion_status: "LOGIN_STARTED" })
      .eq("id", handoff.assessment_id)
      .eq("conversion_status", "INTERESTED");
    if (error) throw new Error("Could not resolve assessment.");
    // No name, scan evidence, or commercial details released before authentication.
    return { ok: true };
  });
export const claimAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string }) => tokenSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { db, hashReference } = await import("./assessment.server");
    const { data: id, error } = await db.rpc("agent_claim_assessment", {
      p_hash: hashReference(data.token),
      p_client: context.userId,
    });
    if (error)
      throw new Error(
        "This assessment could not be linked. Use the client account and a valid, unexpired reference.",
      );
    return { id: id as string };
  });
const policySchema = z
  .object({
    enabled: z.boolean(),
    minimum_pages: z.number().int().min(3).max(1000),
    minimum_domains: z.number().int().min(2).max(100),
    base_annual: z.number().min(0).max(1e8),
    annual_per_domain: z.number().min(0).max(1e7),
    review_minutes_per_page_month: z.number().min(0).max(10000),
    hourly_review_rate: z.number().min(0).max(1e6),
    range_margin: z.number().min(0).max(0.5),
  })
  .strict()
  .refine(
    (p) => !p.enabled || p.base_annual > 0,
    "Set a base annual price before enabling estimates.",
  );
export const agentAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, requireAgent } = await import("./assessment.server");
    if (!(await requireAgent(context.userId)).role.admin) throw new Error("Forbidden");
    const [members, policy] = await Promise.all([
      db.from("agent_memberships").select("*"),
      db.from("agent_pricing_policy").select("*").eq("id", true).single(),
    ]);
    if (members.error || policy.error) throw new Error("Could not load agent configuration.");
    return { members: members.data as { user_id: string; active: boolean }[], policy: policy.data };
  });
export const updateAgentAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("member"), user_id: z.string().uuid(), active: z.boolean() })
          .strict(),
        z.object({ kind: z.literal("pricing"), policy: policySchema }).strict(),
      ])
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, requireAgent } = await import("./assessment.server");
    if (!(await requireAgent(context.userId)).role.admin) throw new Error("Forbidden");
    const { error } = await db.rpc("agent_update_configuration", {
      p_actor: context.userId,
      p_change: data,
    });
    if (error) throw new Error("Could not update agent configuration.");
    return { ok: true };
  });

export const createAgentAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; password: string }) =>
    z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((value) => value.toLowerCase()),
        password: z.string().min(8).max(128),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, access } = await import("./assessment.server");
    const { provisionAgent } = await import("./provision");
    return provisionAgent(data, {
      isAdmin: async () => (await access(context.userId)).admin,
      createUser: async (email, password) => {
        const { data: created, error } = await db.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !created.user)
          throw new Error(
            "Could not create the account. If the email already exists, enable its existing user ID below.",
          );
        return created.user.id;
      },
      enable: async (id) => {
        const { error } = await db.rpc("agent_update_configuration", {
          p_actor: context.userId,
          p_change: { kind: "member", user_id: id, active: true },
        });
        if (error) throw new Error("Could not enable agent access.");
      },
    });
  });
