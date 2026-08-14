import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildCaseEvidenceSnapshot,
  caseNoteFor,
  copyrightCasePriority,
  copyrightCaseSubject,
  eligibilityState,
  isPromotable,
  type CopyrightMatchLike,
} from "./copyright-case-promotion";

/**
 * Copyright finding → case handoff.
 *
 * Owner-scoped and idempotent: a copyright match can only ever be attached to
 * one case (enforced both here and by a unique index on
 * `case_findings (user_id, copyright_match_id)`). Cases open as type "DMCA" and
 * enter the existing Case → Evidence → Enforcement-eligibility pipeline; this
 * function never submits enforcement, never emails anyone and never marks a
 * DMCA recipient verified.
 */

const MATCH_COLUMNS =
  "id,scan_id,source_url,page_title,platform,detection_type,confidence,confidence_band,review_status,reason,transformations,ocr_text,evidence,contact,created_at";

export type PromotableCopyrightMatch = CopyrightMatchLike & {
  work_title: string | null;
  eligibility_state: string;
};

async function linkedMatchIds(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("case_findings")
    .select("copyright_match_id")
    .eq("user_id", userId)
    .not("copyright_match_id", "is", null)
    .limit(5000);
  return new Set(
    ((data ?? []) as { copyright_match_id: string | null }[])
      .map((r) => r.copyright_match_id)
      .filter((v): v is string => !!v),
  );
}

async function workTitles(
  supabase: { from: (t: string) => any },
  userId: string,
  scanIds: string[],
): Promise<Map<string, string>> {
  if (scanIds.length === 0) return new Map();
  const { data } = await supabase
    .from("copyright_scans")
    .select("id,title")
    .eq("user_id", userId)
    .in("id", Array.from(new Set(scanIds)));
  return new Map(((data ?? []) as { id: string; title: string }[]).map((r) => [r.id, r.title]));
}

/** Copyright findings for this account that do not belong to a case yet. */
export const listPromotableCopyrightMatches = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({ scanId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).optional() })
      .parse(data ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<PromotableCopyrightMatch[]> => {
    const { supabase, userId } = context;
    let query = supabase
      .from("copyright_matches")
      .select(MATCH_COLUMNS)
      .eq("user_id", userId)
      .neq("review_status", "dismissed")
      .order("confidence", { ascending: false, nullsFirst: false })
      .limit(data.limit ?? 100);
    if (data.scanId) query = query.eq("scan_id", data.scanId);

    const [{ data: rows, error }, linked] = await Promise.all([
      query,
      linkedMatchIds(supabase, userId),
    ]);
    if (error) throw new Error(error.message);

    const matches = ((rows ?? []) as CopyrightMatchLike[]).filter(
      (m) => !linked.has(m.id) && isPromotable(m),
    );
    const titles = await workTitles(
      supabase,
      userId,
      matches.map((m) => m.scan_id),
    );
    return matches.map((m) => ({
      ...m,
      work_title: titles.get(m.scan_id) ?? null,
      eligibility_state: eligibilityState(m),
    }));
  });

/** Promote copyright findings into DMCA cases. Idempotent and owner-scoped. */
export const promoteCopyrightMatchesToCases = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        matchIds: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(data),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // Owner scoping: only rows belonging to the caller are ever readable here.
    const { data: rows, error } = await supabase
      .from("copyright_matches")
      .select(MATCH_COLUMNS)
      .eq("user_id", userId)
      .in("id", data.matchIds);
    if (error) throw new Error(error.message);

    const linked = await linkedMatchIds(supabase, userId);
    const all = (rows ?? []) as CopyrightMatchLike[];
    const candidates = all.filter((m) => !linked.has(m.id) && isPromotable(m));
    const skipped = all.length - candidates.length;
    const titles = await workTitles(
      supabase,
      userId,
      candidates.map((m) => m.scan_id),
    );

    const caseIds: string[] = [];
    let duplicates = 0;

    for (const m of candidates) {
      const workTitle = titles.get(m.scan_id) ?? null;
      const snapshot = buildCaseEvidenceSnapshot(m, { workId: m.scan_id, workTitle });

      const { data: created, error: caseErr } = await supabase
        .from("cases")
        .insert({
          user_id: userId,
          subject: copyrightCaseSubject(m, workTitle),
          type: "DMCA",
          priority: copyrightCasePriority(m),
          status: "Open",
          notes: m.source_url,
          metadata: snapshot,
        })
        .select("id")
        .single();
      if (caseErr || !created) continue;

      const { error: linkErr } = await supabase.from("case_findings").insert({
        user_id: userId,
        case_id: created.id,
        finding_kind: "copyright_match",
        copyright_match_id: m.id,
        scan_hit_id: null,
        evidence: snapshot,
        note: caseNoteFor(m),
      });

      if (linkErr) {
        // Unique index tripped by a concurrent/duplicate click, or any other
        // failure: never leave a case without its evidence link.
        await supabase.from("cases").delete().eq("id", created.id).eq("user_id", userId);
        if (/duplicate key|unique/i.test(linkErr.message)) duplicates += 1;
        continue;
      }
      caseIds.push(created.id);
    }

    return { created: caseIds.length, skipped: skipped + duplicates, caseIds };
  });
