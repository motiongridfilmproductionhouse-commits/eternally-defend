/**
 * The external enforcement-worker service calls this to fetch a queued job's
 * payload — including decrypted platform credentials for the job's owner —
 * without ever holding the encryption key itself.
 *
 * HMAC-authenticated with AUTOMATION_WORKER_SECRET.
 * Body: `{ job_id }`.
 * Returns the input payload, adapter, target URL, evidence paths, and a
 * decrypted platform storageState (JSON string) if a credential exists.
 * Never returns the encryption key.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ job_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/hooks/automation-fetch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyAutomationRequest } = await import("@/lib/automation/hmac.server");
        const ok = verifyAutomationRequest(
          raw,
          request.headers.get("x-eterna-timestamp"),
          request.headers.get("x-eterna-signature"),
        );
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (e) {
          return new Response(`Invalid body: ${e instanceof Error ? e.message : String(e)}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { decryptVault } = await import("@/lib/automation/vault.server");

        const { data: job, error: jobErr } = await supabaseAdmin
          .from("automation_jobs")
          .select("id,user_id,platform,adapter,status,input_json,attempts")
          .eq("id", parsed.job_id)
          .maybeSingle();
        if (jobErr) return new Response(jobErr.message, { status: 500 });
        if (!job) return new Response("Job not found", { status: 404 });

        // Signed URLs for evidence artifacts.
        const bucket = "enforcement-packages";
        const inputs = job.input_json as Record<string, string | null>;
        const paths = [inputs.evidence_pdf_path, inputs.authorization_pdf_path, inputs.platform_complaint_pdf_path].filter(
          (p): p is string => typeof p === "string" && p.length > 0,
        );
        const signed: Record<string, string> = {};
        for (const p of paths) {
          const { data: url } = await supabaseAdmin.storage.from(bucket).createSignedUrl(p, 60 * 30);
          if (url) signed[p] = url.signedUrl;
        }

        // Load credential (primary label) for this user + platform.
        const { data: cred } = await supabaseAdmin
          .from("platform_credentials")
          .select("id,label,status,storage_state_ciphertext,login_email_ciphertext")
          .eq("user_id", job.user_id)
          .eq("platform", job.platform)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let storageStateJson: string | null = null;
        let loginEmail: string | null = null;
        if (cred) {
          try {
            storageStateJson = decryptVault(cred.storage_state_ciphertext);
            if (cred.login_email_ciphertext) loginEmail = decryptVault(cred.login_email_ciphertext);
          } catch {
            storageStateJson = null;
          }
        }

        // Move to running and increment attempts.
        await supabaseAdmin
          .from("automation_jobs")
          .update({ status: "running", attempts: job.attempts + 1, started_at: new Date().toISOString() })
          .eq("id", job.id);

        return Response.json({
          job_id: job.id,
          adapter: job.adapter,
          platform: job.platform,
          user_id: job.user_id,
          input: job.input_json,
          signed_urls: signed,
          credential: cred
            ? {
                id: cred.id,
                label: cred.label,
                storage_state_json: storageStateJson,
                login_email: loginEmail,
                status: cred.status,
              }
            : null,
        });
      },
    },
  },
});
