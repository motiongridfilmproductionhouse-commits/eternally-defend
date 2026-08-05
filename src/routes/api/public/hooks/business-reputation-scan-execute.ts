/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  registerWaitUntilExecution,
  isVercelWaitUntilRuntime,
} from "@/lib/deepfake/startup-network.server";

const Body = z.object({
  scan_id: z.string().uuid(),
  scan_run_token: z.string().uuid(),
  worker_execution_id: z.string().min(8).max(80).optional(),
  startup_correlation_id: z.string().optional(),
});

export async function handleBusinessReputationWorkerRequest(
  request: Request,
  deps?: {
    verify?: (
      raw: string,
      timestamp: string | null,
      signature: string | null,
    ) => Promise<{ ok: boolean }>;
    execute?: (input: {
      supabase: any;
      scanId: string;
      scanRunToken: string;
      workerExecutionId: string;
      requestId: string;
    }) => Promise<unknown>;
    supabase?: any;
    schedule?: (promise: Promise<unknown>) => { wait_until_used: boolean };
  },
) {
  const raw = await request.text();
  const verifier =
    deps?.verify ||
    (async (body, timestamp, signature) => {
      const { verifyCopyrightScanWorkerRequestDetailed } =
        await import("@/lib/copyright/worker-auth.server");
      return verifyCopyrightScanWorkerRequestDetailed(body, timestamp, signature);
    });
  const verification = await verifier(
    raw,
    request.headers.get("x-eterna-timestamp"),
    request.headers.get("x-eterna-signature"),
  );
  if (!verification.ok) return new Response("Invalid signature", { status: 401 });
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(raw));
  } catch {
    return new Response("Invalid worker payload", { status: 400 });
  }
  const workerExecutionId = parsed.worker_execution_id || randomUUID();
  const supabase =
    deps?.supabase || (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const executor =
    deps?.execute ||
    (await import("@/lib/business-reputation/scan-worker.server")).executeBusinessReputationScan;
  const execution = executor({
    supabase,
    scanId: parsed.scan_id,
    scanRunToken: parsed.scan_run_token,
    workerExecutionId,
    requestId: randomUUID(),
  }).catch(async (error) => {
    await supabase
      .from("scans")
      .update({
        status: "failed",
        error: "Business Reputation worker failed. Please try again.",
        scan_run_token: null,
        lease_expires_at: null,
      })
      .eq("id", parsed.scan_id)
      .eq("scan_type", "business_reputation")
      .eq("scan_run_token", parsed.scan_run_token);
  });
  const scheduled = deps?.schedule
    ? deps.schedule(execution)
    : registerWaitUntilExecution(execution);
  return Response.json(
    {
      accepted: true,
      scan_id: parsed.scan_id,
      worker_execution_id: workerExecutionId,
      wait_until_used: scheduled.wait_until_used,
      vercel_runtime: isVercelWaitUntilRuntime(),
    },
    { status: 202 },
  );
}

export const Route = createFileRoute("/api/public/hooks/business-reputation-scan-execute")({
  server: {
    handlers: { POST: async ({ request }) => handleBusinessReputationWorkerRequest(request) },
  },
});
