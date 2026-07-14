/**
 * Human-review workflow — updates finding review status, severity and notes
 * with full audit history. Replaces the earlier minimal updateFindingReview
 * once wired in; kept as a separate module so the pipeline file stays lean.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const REVIEW_STATES = [
  "unreviewed", "confirmed", "false_positive", "needs_context",
  "escalated", "legally_reviewed", "resolved",
] as const;

const ReviewInput = z.object({
  findingId: z.string().uuid(),
  human_review_status: z.enum(REVIEW_STATES).optional(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
  reviewer_notes: z.string().max(4000).optional(),
  finding_type: z.string().max(80).optional(),
  send_to_radar: z.boolean().optional(),
});

export const reviewFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => ReviewInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: readErr } = await supabase
      .from("timestamp_findings").select("id, human_review_status, severity, finding_type, user_id")
      .eq("id", data.findingId).maybeSingle();
    if (readErr || !existing) throw new Error(readErr?.message ?? "Finding not found");
    if (existing.user_id !== userId) throw new Error("Forbidden");

    const patch: Record<string, unknown> = {
      reviewer_id: userId, reviewed_at: new Date().toISOString(),
    };
    if (data.human_review_status) patch.human_review_status = data.human_review_status;
    if (data.severity) patch.severity = data.severity;
    if (data.reviewer_notes !== undefined) patch.reviewer_notes = data.reviewer_notes;
    if (data.finding_type) patch.finding_type = data.finding_type;
    if (data.send_to_radar) patch.review_status = "sent_to_radar";

    const { error } = await supabase.from("timestamp_findings").update(patch as any).eq("id", data.findingId);
    if (error) throw new Error(error.message);

    await supabase.from("finding_review_history").insert({
      finding_id: data.findingId, reviewer_id: userId,
      from_status: existing.human_review_status ?? "unreviewed",
      to_status: data.human_review_status ?? existing.human_review_status ?? "unreviewed",
      from_severity: existing.severity,
      to_severity: data.severity ?? existing.severity,
      notes: data.reviewer_notes ?? null,
      action: data.send_to_radar ? "escalate_to_radar" : "status_change",
    });
    return { ok: true };
  });

export const getFindingHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ findingId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows } = await supabase.from("finding_review_history")
      .select("*").eq("finding_id", data.findingId).order("created_at", { ascending: false });
    return { history: rows ?? [] };
  });
