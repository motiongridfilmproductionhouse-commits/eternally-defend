import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { caseTypeForFinding, casePriorityForSeverity, caseSubjectFor } from "./case-promotion";

/**
 * Detection → Case handoff.
 *
 * Detections (scan_hits) were accumulating in the thousands while `cases` and
 * `case_findings` stayed empty: the only way to open a case was to type one by
 * hand, and nothing ever wrote the junction row that ties a case back to the
 * detection it came from. These functions make the handoff explicit, traceable
 * and idempotent — a detection can only ever be attached to one case.
 *
 * This records case-management state only. It never submits enforcement,
 * never emails anyone and never changes legal safeguards.
 */

export type PromotableFinding = {
  id: string;
  title: string | null;
  permalink: string | null;
  canonical_url: string | null;
  source: string | null;
  source_type: string | null;
  severity: string | null;
  risk_type: string | null;
  threat_score: number | null;
  first_seen_at: string | null;
};

const HIGH_SEVERITIES = ["Critical", "High"];

async function linkedHitIds(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("case_findings")
    .select("scan_hit_id")
    .eq("user_id", userId)
    .limit(5000);
  return new Set(
    ((data ?? []) as { scan_hit_id: string | null }[])
      .map((r) => r.scan_hit_id)
      .filter((v): v is string => !!v),
  );
}

/** High-severity detections that do not belong to a case yet. */
export const listPromotableFindings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromotableFinding[]> => {
    const { supabase, userId } = context;
    const [hits, linked] = await Promise.all([
      supabase
        .from("scan_hits")
        .select(
          "id,title,permalink,canonical_url,source,source_type,severity,risk_type,threat_score,first_seen_at",
        )
        .eq("user_id", userId)
        .is("hidden_at", null)
        .in("severity", HIGH_SEVERITIES)
        .order("threat_score", { ascending: false, nullsFirst: false })
        .limit(200),
      linkedHitIds(supabase, userId),
    ]);
    return ((hits.data ?? []) as PromotableFinding[]).filter((h) => !linked.has(h.id));
  });

/**
 * Promote detections into cases. Each detection becomes (or joins) exactly one
 * case and always gets a `case_findings` row, so the case board can be traced
 * back to the evidence that opened it.
 */
export const promoteFindingsToCases = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        hitIds: z.array(z.string().uuid()).min(1).max(50).optional(),
        /** Promote every unlinked high-severity detection (capped). */
        all: z.boolean().optional(),
      })
      .parse(data),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const linked = await linkedHitIds(supabase, userId);

    let query = supabase
      .from("scan_hits")
      .select(
        "id,title,permalink,canonical_url,source,source_type,severity,risk_type,threat_score,first_seen_at",
      )
      .eq("user_id", userId)
      .is("hidden_at", null);

    if (data.hitIds?.length) {
      query = query.in("id", data.hitIds);
    } else if (data.all) {
      query = query.in("severity", HIGH_SEVERITIES).limit(50);
    } else {
      return { created: 0, skipped: 0, caseIds: [] as string[] };
    }

    const { data: hits, error } = await query;
    if (error) throw new Error(error.message);

    const candidates = ((hits ?? []) as PromotableFinding[]).filter((h) => !linked.has(h.id));
    const skipped = ((hits ?? []) as PromotableFinding[]).length - candidates.length;

    const caseIds: string[] = [];
    for (const hit of candidates) {
      const { data: created, error: caseErr } = await supabase
        .from("cases")
        .insert({
          user_id: userId,
          subject: caseSubjectFor(hit),
          type: caseTypeForFinding(hit),
          priority: casePriorityForSeverity(hit.severity),
          status: "Open",
          notes: hit.permalink ?? hit.canonical_url ?? null,
          metadata: {
            origin: "detection_promotion",
            scan_hit_id: hit.id,
            source: hit.source,
            source_type: hit.source_type,
            threat_score: hit.threat_score,
            first_seen_at: hit.first_seen_at,
          },
        })
        .select("id")
        .single();
      if (caseErr || !created) continue;

      const { error: linkErr } = await supabase.from("case_findings").insert({
        user_id: userId,
        case_id: created.id,
        scan_hit_id: hit.id,
        note: `Auto-promoted from ${hit.severity ?? "detection"} · score ${hit.threat_score ?? "n/a"}`,
      });
      if (linkErr) {
        // Never leave a case without its evidence link.
        await supabase.from("cases").delete().eq("id", created.id).eq("user_id", userId);
        continue;
      }
      caseIds.push(created.id);
    }

    return { created: caseIds.length, skipped, caseIds };
  });

/** Detections attached to a case, for the case board detail view. */
export const listCaseFindings = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ caseId: z.string().uuid() }).parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("case_findings")
      .select("id,note,created_at,scan_hit_id")
      .eq("user_id", userId)
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const hitIds = (rows ?? []).map((r) => r.scan_hit_id).filter((v): v is string => !!v);
    if (hitIds.length === 0) return [];
    const { data: hits } = await supabase
      .from("scan_hits")
      .select("id,title,permalink,canonical_url,severity,threat_score,source")
      .eq("user_id", userId)
      .in("id", hitIds);
    const byId = new Map((hits ?? []).map((h) => [h.id, h]));
    return (rows ?? []).map((r) => ({
      ...r,
      hit: r.scan_hit_id ? (byId.get(r.scan_hit_id) ?? null) : null,
    }));
  });
