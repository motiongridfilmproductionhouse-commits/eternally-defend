import { createHmac } from "node:crypto";
import { config } from "./config.js";

function sign(body: string): { signature: string; timestamp: string } {
  const ts = Date.now();
  const signature = createHmac("sha256", config.AUTOMATION_WORKER_SECRET).update(`${ts}.${body}`).digest("hex");
  return { signature, timestamp: String(ts) };
}

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const raw = JSON.stringify(body);
  const { signature, timestamp } = sign(raw);
  const res = await fetch(`${config.ETERNA_HOOK_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eterna-timestamp": timestamp,
      "x-eterna-signature": signature,
    },
    body: raw,
  });
  if (!res.ok) throw new Error(`Eterna hook ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface FetchedJob {
  job_id: string;
  adapter: "youtube_copyright" | "youtube_community";
  platform: "youtube";
  user_id: string;
  input: {
    enforcement_request_id: string;
    target_url: string | null;
    evidence_pdf_path: string | null;
    authorization_pdf_path: string | null;
    platform_complaint_pdf_path: string | null;
    method: string;
  };
  signed_urls: Record<string, string>;
  credential: {
    id: string;
    label: string;
    storage_state_json: string | null;
    login_email: string | null;
    status: "active" | "expired" | "login_required";
  } | null;
}

export const eterna = {
  fetchJob: (jobId: string) => post<FetchedJob>("/api/public/hooks/automation-fetch", { job_id: jobId }),

  event: (evt: {
    job_id: string;
    event: string;
    status?: "queued" | "running" | "review_ready" | "submitted" | "failed" | "cancelled";
    result?: "ok" | "error";
    duration_ms?: number;
    payload?: Record<string, unknown>;
    screenshot_path?: string;
    review_summary?: Record<string, unknown>;
    review_bundle_path?: string;
    cdp_ws_url?: string;
    cdp_expires_at?: string;
    error?: Record<string, unknown>;
    worker_id?: string;
  }) => post("/api/public/hooks/automation-status", { worker_id: config.WORKER_ID, ...evt }),
};
