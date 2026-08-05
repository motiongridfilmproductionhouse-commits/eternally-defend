import { randomUUID } from "node:crypto";

export const BUSINESS_WORKER_BUDGET_MS = 35_000;
export const BUSINESS_WORKER_SAFETY_BUFFER_MS = 5_000;
export const BUSINESS_LEASE_TTL_MS = 90_000;
export const BUSINESS_HANDOFF_LEASE_TTL_MS = 300_000;
export const BUSINESS_STALE_RECOVERY_GRACE_MS = 30_000;

export function businessStaleRecoveryGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.BUSINESS_REPUTATION_STALE_RECOVERY_GRACE_MS);
  return Number.isFinite(configured) && configured >= 5_000
    ? configured
    : BUSINESS_STALE_RECOVERY_GRACE_MS;
}

export type BusinessScanCheckpoint = {
  version: 1;
  queries: string[];
  next_query_index: number;
  completed_query_indexes: number[];
  pending_query_queue: string[];
  findings_count: number;
  provider_warnings: string[];
  discovery_state: Record<string, unknown>;
  last_batch_at: string | null;
};

export function createBusinessCheckpoint(
  queries: string[],
  existing?: Partial<BusinessScanCheckpoint> | null,
): BusinessScanCheckpoint {
  return {
    version: 1,
    queries,
    next_query_index: existing?.next_query_index ?? 0,
    completed_query_indexes: existing?.completed_query_indexes ?? [],
    pending_query_queue: queries.slice(existing?.next_query_index ?? 0),
    findings_count: existing?.findings_count ?? 0,
    provider_warnings: existing?.provider_warnings ?? [],
    discovery_state: existing?.discovery_state ?? {},
    last_batch_at: existing?.last_batch_at ?? null,
  };
}

export function shouldYieldBusinessWorker(input: {
  startedAtMs: number;
  nowMs?: number;
  budgetMs?: number;
}): boolean {
  return (
    (input.nowMs ?? Date.now()) - input.startedAtMs >=
    (input.budgetMs ?? BUSINESS_WORKER_BUDGET_MS) - BUSINESS_WORKER_SAFETY_BUFFER_MS
  );
}

export function parseBusinessCheckpoint(value: unknown): BusinessScanCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<BusinessScanCheckpoint>;
  if (row.version !== 1 || !Array.isArray(row.queries)) return null;
  return createBusinessCheckpoint(row.queries, row);
}

export async function transferBusinessLease(input: {
  // Supabase's generated client type is intentionally not coupled to this worker seam.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  scanId: string;
  currentToken: string;
  checkpoint: BusinessScanCheckpoint;
  nowMs?: number;
}) {
  const nextToken = randomUUID();
  const now = input.nowMs ?? Date.now();
  const { data, error } = await input.supabase
    .from("scans")
    .update({
      scan_run_token: nextToken,
      heartbeat_at: new Date(now).toISOString(),
      lease_expires_at: new Date(now + BUSINESS_HANDOFF_LEASE_TTL_MS).toISOString(),
      scan_checkpoint: input.checkpoint,
      discovery_metrics: {
        phase: "continuation_scheduled",
        percent: Math.min(
          99,
          Math.round(
            (input.checkpoint.next_query_index / Math.max(1, input.checkpoint.queries.length)) *
              100,
          ),
        ),
        continuation_scheduled_at: new Date(now).toISOString(),
      },
    })
    .eq("id", input.scanId)
    .eq("scan_type", "business_reputation")
    .eq("status", "running")
    .eq("scan_run_token", input.currentToken)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Business Reputation lease transfer lost ownership");
  return { nextToken, leaseExpiresAt: new Date(now + BUSINESS_HANDOFF_LEASE_TTL_MS).toISOString() };
}

export async function recoverStaleBusinessScan(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  scanId: string;
  dispatch: (args: {
    scanId: string;
    scanRunToken: string;
    startupCorrelationId: string;
  }) => Promise<{ dispatched: boolean; reason?: string | null }>;
  nowMs?: number;
}) {
  const now = input.nowMs ?? Date.now();
  const cutoff = now - businessStaleRecoveryGraceMs();
  const { data: row, error: readError } = await input.supabase
    .from("scans")
    .select("id,status,scan_run_token,lease_expires_at,heartbeat_at,scan_checkpoint")
    .eq("id", input.scanId)
    .eq("scan_type", "business_reputation")
    .eq("status", "running")
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row?.scan_run_token || !row.lease_expires_at)
    return { recovered: false, reason: "not_running" };
  const leaseExpired = Date.parse(row.lease_expires_at) < cutoff;
  const heartbeatStopped = !row.heartbeat_at || Date.parse(row.heartbeat_at) < cutoff;
  if (!leaseExpired || !heartbeatStopped) return { recovered: false, reason: "lease_not_stale" };
  const nextToken = randomUUID();
  const { data, error } = await input.supabase
    .from("scans")
    .update({
      scan_run_token: nextToken,
      heartbeat_at: new Date(now).toISOString(),
      lease_expires_at: new Date(now + BUSINESS_HANDOFF_LEASE_TTL_MS).toISOString(),
      discovery_metrics: {
        phase: "stale_recovery_dispatch",
        stale_recovered_at: new Date(now).toISOString(),
      },
    })
    .eq("id", input.scanId)
    .eq("scan_type", "business_reputation")
    .eq("status", "running")
    .eq("scan_run_token", row.scan_run_token)
    .lt("lease_expires_at", new Date(cutoff).toISOString())
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) return { recovered: false, reason: "ownership_lost" };
  const dispatch = await input.dispatch({
    scanId: input.scanId,
    scanRunToken: nextToken,
    startupCorrelationId: randomUUID(),
  });
  if (!dispatch.dispatched)
    await input.supabase
      .from("scans")
      .update({
        status: "failed",
        error: "Business Reputation recovery worker could not be started.",
        scan_run_token: null,
        lease_expires_at: null,
      })
      .eq("id", input.scanId)
      .eq("status", "running")
      .eq("scan_run_token", nextToken);
  return { recovered: true, dispatch };
}

export async function recoverStaleBusinessScans(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  dispatch: (args: {
    scanId: string;
    scanRunToken: string;
    startupCorrelationId: string;
  }) => Promise<{ dispatched: boolean; reason?: string | null }>;
  nowMs?: number;
}) {
  const { data, error } = await input.supabase
    .from("scans")
    .select("id")
    .eq("scan_type", "business_reputation")
    .eq("status", "running");
  if (error) throw new Error(error.message);
  const results = [];
  for (const row of data || [])
    results.push(await recoverStaleBusinessScan({ ...input, scanId: row.id }));
  return results;
}
