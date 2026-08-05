import { randomUUID } from "node:crypto";
import { signCopyrightScanWorkerRequest } from "@/lib/copyright/worker-auth.server";

export function resolveBusinessReputationWorkerUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env.BUSINESS_REPUTATION_SCAN_WORKER_URL?.trim();
  if (configured) return configured;
  const base =
    env.BUSINESS_REPUTATION_SCAN_WORKER_BASE_URL?.trim() ||
    env.SITE_URL?.trim() ||
    env.VITE_SITE_URL?.trim();
  return base
    ? `${base.replace(/\/$/, "")}/api/public/hooks/business-reputation-scan-execute`
    : null;
}

export async function dispatchBusinessReputationScan(input: {
  scanId: string;
  scanRunToken: string;
  startupCorrelationId?: string | null;
}) {
  const workerUrl = resolveBusinessReputationWorkerUrl();
  const executionId = randomUUID();
  if (!workerUrl) return { dispatched: false, reason: "worker_url_not_configured", executionId };
  const body = JSON.stringify({
    scan_id: input.scanId,
    scan_run_token: input.scanRunToken,
    worker_execution_id: executionId,
    startup_correlation_id: input.startupCorrelationId ?? null,
  });
  try {
    const signed = await signCopyrightScanWorkerRequest(body);
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eterna-timestamp": signed.timestamp,
        "x-eterna-signature": signed.signature,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    return {
      dispatched: response.ok || response.status === 202,
      reason: response.ok || response.status === 202 ? null : `worker_http_${response.status}`,
      executionId,
    };
  } catch (error) {
    return {
      dispatched: false,
      reason: error instanceof Error ? error.message.slice(0, 300) : String(error),
      executionId,
    };
  }
}
