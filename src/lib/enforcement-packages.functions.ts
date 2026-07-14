/**
 * Server functions that build Evidence + Authorization + Platform Complaint
 * packages for one or more scan_hits, upload them to the private
 * enforcement-packages bucket, and record the resulting enforcement_requests +
 * enforcement_package_items rows.
 *
 * Server-only imports (pdf-lib, client.server) are loaded INSIDE the handler
 * so this module stays safe to import from client-reachable route files.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const MethodSchema = z.enum(["DMCA", "Platform Report", "Legal Notice"]);

const GenerateInput = z.object({
  scanHitIds: z.array(z.string().uuid()).min(1).max(50),
  method: MethodSchema,
  dryRun: z.boolean().optional().default(false),
});

interface PackageResult {
  scanHitId: string;
  enforcementRequestId: string | null;
  evidencePath: string | null;
  authorizationPath: string | null;
  complaintPath: string | null;
  error: string | null;
}

export const generateEnforcementPackages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data, context }): Promise<{ results: PackageResult[] }> => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildEvidencePdf, buildAuthorizationPdf, buildComplaintPdf } = await import("./enforcement/pdf.server");
    const { buildComplaint } = await import("./enforcement/platform-templates.server");

    const [{ data: profile }, { data: auth }] = await Promise.all([
      supabase.from("client_profiles").select("full_name,company_name,email,country,client_type").eq("user_id", userId).maybeSingle(),
      supabase
        .from("authorization_records")
        .select("legal_name,signature_text,signed_at,signature_hash,authorization_level,ip_address,user_agent")
        .eq("user_id", userId)
        .eq("active", true)
        .order("signed_at", { ascending: false })
        .maybeSingle(),
    ]);

    if (!data.dryRun && !auth) {
      throw new Error("No active authorization on file. Complete onboarding before submitting enforcement requests.");
    }

    const complainantName =
      auth?.legal_name || profile?.full_name || profile?.company_name || "Authorized Representative";

    const { data: hits, error: hitsErr } = await supabase
      .from("scan_hits")
      .select("id,title,description,permalink,canonical_url,source,source_type,author,published_at,severity,threat_score,narrative_claim")
      .eq("user_id", userId)
      .in("id", data.scanHitIds);
    if (hitsErr) throw hitsErr;

    const results: PackageResult[] = [];

    for (const hit of hits ?? []) {
      try {
        const targetUrl = hit.permalink || hit.canonical_url || "";
        const platform = hit.source_type || hit.source || "Web";

        // video_timestamp_findings is the only evidence table linked directly by scan_hit_id.
        const [vtsRes, claimsRes, fcRes] = await Promise.all([
          supabase
            .from("video_timestamp_findings")
            .select("start_seconds,end_seconds,original_text,translated_text,severity")
            .eq("scan_hit_id", hit.id)
            .limit(200),
          supabase
            .from("extracted_claims")
            .select("extracted_claim,claimant,fact_check_status")
            .eq("user_id", userId)
            .limit(25),
          supabase
            .from("fact_check_matches")
            .select("publisher_name,review_title,review_url,textual_rating")
            .eq("user_id", userId)
            .limit(25),
        ]);

        const timestamps = ((vtsRes.data ?? []) as Array<{
          start_seconds: number | null;
          end_seconds: number | null;
          original_text: string | null;
          translated_text: string | null;
          severity: string | null;
        }>).map((r) => ({
          startSeconds: r.start_seconds ?? 0,
          endSeconds: r.end_seconds ?? null,
          excerpt: r.translated_text || r.original_text || "",
          severity: r.severity,
        }));

        const claims = ((claimsRes.data ?? []) as Array<{
          extracted_claim: string; claimant: string | null; fact_check_status: string | null;
        }>).map((c) => ({ extracted: c.extracted_claim, claimant: c.claimant, status: c.fact_check_status }));

        const factChecks = ((fcRes.data ?? []) as Array<{
          publisher_name: string; review_title: string; review_url: string; textual_rating: string | null;
        }>).map((f) => ({ publisher: f.publisher_name, title: f.review_title, url: f.review_url, rating: f.textual_rating }));

        const capturedAt = new Date().toISOString();
        const contentHash = await sha256Hex(`${hit.id}|${targetUrl}|${capturedAt}`);

        const evidenceBytes = await buildEvidencePdf({
          finding: {
            id: hit.id,
            title: hit.title ?? "Untitled finding",
            url: targetUrl,
            source: hit.source,
            platform,
            severity: hit.severity,
            threatScore: hit.threat_score,
            author: hit.author,
            publishedAt: hit.published_at,
            description: hit.description,
          },
          timestamps,
          claims,
          factChecks,
          evidenceFrames: [],
          capturedAt,
          contentHash,
        });

        if (data.dryRun) {
          const key = `${userId}/dryrun/${hit.id}-${Date.now()}/evidence.pdf`;
          await uploadPdf(supabaseAdmin, key, evidenceBytes);
          results.push({
            scanHitId: hit.id,
            enforcementRequestId: null,
            evidencePath: key,
            authorizationPath: null,
            complaintPath: null,
            error: null,
          });
          continue;
        }

        const complaint = buildComplaint({
          method: data.method,
          source: hit.source,
          platform,
          title: hit.title ?? "Untitled finding",
          targetUrl,
          publishedAt: hit.published_at,
          author: hit.author,
          claimSummary: hit.narrative_claim,
          timestampsCount: timestamps.length,
          factCheckMatches: factChecks.length,
          hasEvidenceFrames: false,
          complainant: {
            legalName: complainantName,
            email: profile?.email ?? undefined,
            country: profile?.country ?? undefined,
            authorizationLevel: auth?.authorization_level ?? undefined,
            signedAt: auth?.signed_at ?? undefined,
          },
        });

        const authorizationBytes = await buildAuthorizationPdf({
          legalName: complainantName,
          email: profile?.email ?? null,
          country: profile?.country ?? null,
          authorizationLevel: auth?.authorization_level ?? "self",
          signatureText: auth?.signature_text ?? null,
          signedAt: auth?.signed_at ?? null,
          signatureHash: auth?.signature_hash ?? null,
          ipAddress: auth?.ip_address ?? null,
          userAgent: auth?.user_agent ?? null,
          clientType: profile?.client_type ?? null,
          requestSummary: `${data.method} regarding "${hit.title ?? targetUrl}" on ${platform}.`,
        });

        const complaintBytes = await buildComplaintPdf(complaint, hit.title ?? "Complaint");

        const { data: reqRow, error: reqErr } = await supabase
          .from("enforcement_requests")
          .insert({
            user_id: userId,
            scan_hit_id: hit.id,
            platform,
            method: data.method,
            target_url: targetUrl || null,
            status: "Queued",
            metadata: { evidence_strength: complaint.evidenceStrength, complaint_kind: complaint.kind },
          })
          .select("id")
          .single();
        if (reqErr || !reqRow) throw reqErr ?? new Error("Failed to create enforcement request");
        const reqId = reqRow.id;

        const base = `${userId}/${reqId}`;
        const evidencePath = `${base}/evidence.pdf`;
        const authPath = `${base}/authorization.pdf`;
        const complaintPath = `${base}/complaint.pdf`;

        await Promise.all([
          uploadPdf(supabaseAdmin, evidencePath, evidenceBytes),
          uploadPdf(supabaseAdmin, authPath, authorizationBytes),
          uploadPdf(supabaseAdmin, complaintPath, complaintBytes),
        ]);

        await supabase
          .from("enforcement_requests")
          .update({
            evidence_pdf_path: evidencePath,
            authorization_pdf_path: authPath,
            platform_complaint_pdf_path: complaintPath,
            platform_complaint_json: JSON.parse(JSON.stringify(complaint)),
            package_generated_at: capturedAt,
            package_hash: contentHash,
          })
          .eq("id", reqId);

        await supabase.from("enforcement_package_items").insert([
          { user_id: userId, enforcement_request_id: reqId, kind: "evidence", storage_path: evidencePath, sha256: contentHash, bytes: evidenceBytes.byteLength },
          { user_id: userId, enforcement_request_id: reqId, kind: "authorization", storage_path: authPath, bytes: authorizationBytes.byteLength },
          { user_id: userId, enforcement_request_id: reqId, kind: "platform_complaint", storage_path: complaintPath, bytes: complaintBytes.byteLength },
        ]);

        results.push({
          scanHitId: hit.id,
          enforcementRequestId: reqId,
          evidencePath,
          authorizationPath: authPath,
          complaintPath,
          error: null,
        });
      } catch (e) {
        console.error("[enforcement-package] failed for", hit.id, e);
        results.push({
          scanHitId: hit.id,
          enforcementRequestId: null,
          evidencePath: null,
          authorizationPath: null,
          complaintPath: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { results };
  });

/** Short-lived signed URL for a package artifact the caller owns. */
export const signPackageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ path: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { userId } = context;
    if (!data.path.startsWith(`${userId}/`)) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("enforcement-packages")
      .createSignedUrl(data.path, 60 * 10);
    if (error || !signed) throw error ?? new Error("Failed to sign URL");
    return { url: signed.signedUrl };
  });

async function uploadPdf(admin: SupabaseClient, path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await admin.storage.from("enforcement-packages").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
