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
      .select(
        "id,title,description,permalink,canonical_url,source,source_type,author,published_at,severity,threat_score,reach,engagement,thumbnail_url,narrative_claim,risk_type,detected_at",
      )
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
    const enc = new TextEncoder().encode(
      JSON.stringify({ hit_id: hit.id, url: targetUrl, payload }),
    );
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const hash = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

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

const RemovalVerificationDocumentInput = z.object({
  enforcementRequestId: z.string().uuid(),
  documentType: z.enum(["client_identity", "signed_authorization"]),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  fileBase64: z.string().min(16).max(14_000_000),
});

const RemovalVerificationStatusInput = z.object({
  enforcementRequestId: z.string().uuid(),
});

const SUBMITTED_REQUEST_STATUSES = [
  "Queued",
  "Sent",
  "Approved",
  "SUBMITTED",
  "UNDER_REVIEW",
] as const;

/** Return the caller's latest Central System request that still needs verification documents. */
export const getLatestRemovalVerificationRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: requests, error } = await context.supabase
      .from("enforcement_requests")
      .select("id,status,platform,target_url,created_at")
      .eq("user_id", context.userId)
      .in("status", [...SUBMITTED_REQUEST_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const request = requests?.[0];
    if (!request) return null;
    return request;
  });

/** Attach a private verification document to the caller's already-submitted request. */
export const uploadRemovalVerificationDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RemovalVerificationDocumentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: request, error: requestError } = await supabase
      .from("enforcement_requests")
      .select("id,status")
      .eq("id", data.enforcementRequestId)
      .eq("user_id", userId)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request) throw new Error("Removal request not found.");
    if (!(SUBMITTED_REQUEST_STATUSES as readonly string[]).includes(request.status)) {
      throw new Error("Verification documents can only be added to a submitted removal request.");
    }

    const encoded = data.fileBase64.includes(",") ? data.fileBase64.split(",")[1] : data.fileBase64;
    const bytes = Buffer.from(encoded ?? "", "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
      throw new Error("Document must be smaller than 10 MB.");
    }

    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `clients/${userId}/removal-verification/${request.id}/${data.documentType}-${crypto.randomUUID()}-${safeName}`;
    const { storeOnboardingDocument } = await import("@/lib/onboarding/document-storage.server");
    const storagePath = await storeOnboardingDocument({
      supabase,
      userId,
      key,
      bytes,
      contentType: data.mimeType,
    });

    const { error } = await supabase.from("enforcement_evidence").insert({
      user_id: userId,
      enforcement_request_id: request.id,
      evidence_type: `verification_${data.documentType}`,
      storage_path: storagePath,
      payload: {
        filename: safeName,
        mime_type: data.mimeType,
        review_status: "DOCUMENTS_REQUIRED",
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true, documentType: data.documentType, filename: safeName };
  });

/** Return only document-presence metadata for the caller's own request. */
export const getRemovalVerificationDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RemovalVerificationStatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: request, error: requestError } = await context.supabase
      .from("enforcement_requests")
      .select("id")
      .eq("id", data.enforcementRequestId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request) throw new Error("Removal request not found.");

    const { data: documents, error } = await context.supabase
      .from("enforcement_evidence")
      .select("evidence_type,payload,created_at")
      .eq("user_id", context.userId)
      .eq("enforcement_request_id", request.id)
      .in("evidence_type", ["verification_client_identity", "verification_signed_authorization"])
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const latest: Record<string, { filename: string; uploadedAt: string }> = {};
    for (const document of documents ?? []) {
      if (latest[document.evidence_type]) continue;
      const payload = (document.payload ?? {}) as Record<string, unknown>;
      latest[document.evidence_type] = {
        filename: typeof payload.filename === "string" ? payload.filename : "Document uploaded",
        uploadedAt: document.created_at,
      };
    }
    return {
      clientIdentity: latest.verification_client_identity ?? null,
      signedAuthorization: latest.verification_signed_authorization ?? null,
    };
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
  .inputValidator((d: unknown) =>
    z.object({ scanHitIds: z.array(z.string().uuid()).min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: reqs, error } = await supabase
      .from("enforcement_requests")
      .select("id,scan_hit_id,status,created_at")
      .eq("user_id", userId)
      .in("scan_hit_id", data.scanHitIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const requestIds = (reqs ?? []).map((r) => r.id);
    const evByReq = new Map<string, number>();
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
    const byHit: Record<
      string,
      { evidenceCount: number; status: string | null; requestId: string | null }
    > = {};
    for (const hid of data.scanHitIds)
      byHit[hid] = { evidenceCount: 0, status: null, requestId: null };
    for (const r of reqs ?? []) {
      if (!r.scan_hit_id) continue;
      const cur = byHit[r.scan_hit_id];
      const count = evByReq.get(r.id) ?? 0;
      cur.evidenceCount += count;
      // Prefer latest non-Draft status
      if (!cur.status || (cur.status === "Draft" && r.status !== "Draft")) {
        cur.status = r.status;
        cur.requestId = r.id;
      }
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
