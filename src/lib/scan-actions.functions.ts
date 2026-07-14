import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const HideInput = z.object({
  scanHitId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export const hideScanHit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => HideInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("scan_hits")
      .update({
        hidden_at: new Date().toISOString(),
        hidden_reason: data.reason ?? null,
        hidden_by_user_id: userId,
      })
      .eq("id", data.scanHitId)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const unhideScanHit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ scanHitId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("scan_hits")
      .update({ hidden_at: null, hidden_reason: null, hidden_by_user_id: null })
      .eq("id", data.scanHitId)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

const AddEvidenceInput = z.object({
  scanHitId: z.string().uuid(),
  note: z.string().max(2000).optional(),
});

/** Create (or reuse) a Draft enforcement_request for this scan_hit and log an evidence row. */
export const addEvidenceForHit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddEvidenceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: hit, error: hitErr } = await supabase
      .from("scan_hits")
      .select("id,title,description,permalink,canonical_url,source,source_type,author,published_at,severity,threat_score,reach,engagement,thumbnail_url,narrative_claim,risk_type,detected_at")
      .eq("id", data.scanHitId)
      .eq("user_id", userId)
      .maybeSingle();
    if (hitErr) throw hitErr;
    if (!hit) throw new Error("Finding not found");

    const targetUrl = hit.permalink || hit.canonical_url || "";
    const platform = hit.source_type || hit.source || "Web";

    // Find or create Draft enforcement_request for this hit
    let requestId: string | null = null;
    const { data: existing } = await supabase
      .from("enforcement_requests")
      .select("id")
      .eq("user_id", userId)
      .eq("scan_hit_id", hit.id)
      .in("status", ["Draft", "Evidence Review", "Authorization Pending", "Ready for Approval"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      requestId = existing.id;
    } else {
      const { data: created, error: reqErr } = await supabase
        .from("enforcement_requests")
        .insert({
          user_id: userId,
          scan_hit_id: hit.id,
          platform,
          method: "Evidence",
          target_url: targetUrl || null,
          status: "Draft",
        })
        .select("id")
        .single();
      if (reqErr || !created) throw reqErr ?? new Error("Failed to create enforcement request");
      requestId = created.id;
    }

    const capturedAt = new Date().toISOString();
    const payload = {
      captured_at: capturedAt,
      source: hit.source,
      platform,
      title: hit.title,
      description: hit.description,
      author: hit.author,
      published_at: hit.published_at,
      severity: hit.severity,
      threat_score: hit.threat_score,
      reach: hit.reach,
      engagement: hit.engagement,
      thumbnail_url: hit.thumbnail_url,
      narrative_claim: hit.narrative_claim,
      risk_type: hit.risk_type,
      note: data.note ?? null,
    };

    // SHA-256 of the payload for tamper-evident evidence
    const enc = new TextEncoder().encode(JSON.stringify({ hit_id: hit.id, url: targetUrl, payload }));
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { error: evErr } = await supabase.from("enforcement_evidence").insert({
      user_id: userId,
      enforcement_request_id: requestId,
      evidence_type: "scan_snapshot",
      reference: targetUrl || null,
      payload: { ...payload, sha256: hash, scan_hit_id: hit.id },
    });
    if (evErr) throw evErr;

    return { ok: true, enforcementRequestId: requestId, sha256: hash };
  });

const TakeActionInput = z.object({
  scanHitId: z.string().uuid(),
  method: z.string().min(1).max(80),
});

/** Create an enforcement_request in Draft status. Never auto-submits. */
export const createEnforcementRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TakeActionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: hit, error: hitErr } = await supabase
      .from("scan_hits")
      .select("id,permalink,canonical_url,source,source_type,title")
      .eq("id", data.scanHitId)
      .eq("user_id", userId)
      .maybeSingle();
    if (hitErr) throw hitErr;
    if (!hit) throw new Error("Finding not found");

    const targetUrl = hit.permalink || hit.canonical_url || "";
    const platform = hit.source_type || hit.source || "Web";

    const { data: created, error } = await supabase
      .from("enforcement_requests")
      .insert({
        user_id: userId,
        scan_hit_id: hit.id,
        platform,
        method: data.method,
        target_url: targetUrl || null,
        status: "Draft",
        metadata: { created_from: "scan_action_drawer" },
      })
      .select("id,status,method,platform")
      .single();
    if (error || !created) throw error ?? new Error("Failed to create request");
    return { ok: true, request: created };
  });

/** Counts evidence rows and current enforcement status for a set of scan_hit ids. */
export const listEvidenceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ scanHitIds: z.array(z.string().uuid()).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: reqs, error } = await supabase
      .from("enforcement_requests")
      .select("id,scan_hit_id,status")
      .eq("user_id", userId)
      .in("scan_hit_id", data.scanHitIds);
    if (error) throw error;
    const requestIds = (reqs ?? []).map((r) => r.id);
    let evByReq = new Map<string, number>();
    if (requestIds.length) {
      const { data: evs } = await supabase
        .from("enforcement_evidence")
        .select("enforcement_request_id")
        .eq("user_id", userId)
        .in("enforcement_request_id", requestIds);
      for (const e of evs ?? []) {
        evByReq.set(e.enforcement_request_id, (evByReq.get(e.enforcement_request_id) ?? 0) + 1);
      }
    }
    const byHit: Record<string, { evidenceCount: number; status: string | null; requestId: string | null }> = {};
    for (const hid of data.scanHitIds) byHit[hid] = { evidenceCount: 0, status: null, requestId: null };
    for (const r of reqs ?? []) {
      if (!r.scan_hit_id) continue;
      const cur = byHit[r.scan_hit_id];
      const count = evByReq.get(r.id) ?? 0;
      cur.evidenceCount += count;
      // Prefer latest non-Draft status
      if (!cur.status || cur.status === "Draft") cur.status = r.status;
      if (!cur.requestId) cur.requestId = r.id;
    }
    return { byHit };
  });

export const setSidebarCollapsed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ collapsed: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("client_profiles")
      .update({ sidebar_collapsed: data.collapsed })
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
