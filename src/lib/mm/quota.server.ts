/**
 * Environment-driven cost, quota, and retention limits.
 * All values have safe defaults so the pipeline runs even when unset.
 */
export interface QuotaLimits {
  maxVideoMinutes: number;
  maxUploadMb: number;
  dailyAnalysisLimit: number;
  monthlyCostLimitUsd: number;
  evidenceRetentionDays: number;
}

export function getLimits(): QuotaLimits {
  const num = (v: string | undefined, d: number) => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    maxVideoMinutes: num(process.env.MM_MAX_VIDEO_MINUTES, 60),
    maxUploadMb: num(process.env.MM_MAX_UPLOAD_MB, 500),
    dailyAnalysisLimit: num(process.env.MM_DAILY_ANALYSIS_LIMIT, 25),
    monthlyCostLimitUsd: num(process.env.MM_MONTHLY_COST_LIMIT_USD, 50),
    evidenceRetentionDays: num(process.env.MM_EVIDENCE_RETENTION_DAYS, 90),
  };
}

/** Rough cost estimate in cents for a job of a given length. */
export function estimateCostCents(input: {
  durationSeconds?: number | null;
  hasVideoIntel: boolean;
  hasStt: boolean;
  hasVision: boolean;
  claimsToCheck?: number;
}): number {
  const minutes = Math.max(0, (input.durationSeconds ?? 0) / 60);
  let cents = 0;
  if (input.hasVideoIntel) cents += Math.ceil(minutes * 10); // ~$0.10/min
  if (input.hasStt) cents += Math.ceil(minutes * 6);          // ~$0.06/min
  if (input.hasVision) cents += Math.ceil((minutes / 60) * 150); // frames sampled
  cents += (input.claimsToCheck ?? 0) * 1; // Fact Check + Gemini per claim
  return cents;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  todayUsed: number;
  monthCostCents: number;
  limits: QuotaLimits;
}

export async function checkAndReserveQuota(
  supabase: any,
  userId: string,
  costCents: number,
): Promise<QuotaCheckResult> {
  const limits = getLimits();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  const [todayRow, monthAgg] = await Promise.all([
    supabase.from("quota_usage").select("analyses_count, cost_cents").eq("user_id", userId).eq("usage_date", today).maybeSingle(),
    supabase.from("quota_usage").select("cost_cents").eq("user_id", userId).gte("usage_date", monthStart.toISOString().slice(0, 10)),
  ]);
  const todayUsed = todayRow.data?.analyses_count ?? 0;
  const monthCostCents = (monthAgg.data ?? []).reduce((s: number, r: any) => s + (r.cost_cents ?? 0), 0);

  if (todayUsed >= limits.dailyAnalysisLimit) {
    return { allowed: false, reason: `Daily analysis limit reached (${limits.dailyAnalysisLimit}/day)`, todayUsed, monthCostCents, limits };
  }
  if ((monthCostCents + costCents) / 100 > limits.monthlyCostLimitUsd) {
    return { allowed: false, reason: `Monthly cost limit would be exceeded ($${limits.monthlyCostLimitUsd})`, todayUsed, monthCostCents, limits };
  }
  // Reserve
  await supabase.from("quota_usage").upsert({
    user_id: userId,
    usage_date: today,
    analyses_count: todayUsed + 1,
    cost_cents: (todayRow.data?.cost_cents ?? 0) + costCents,
  }, { onConflict: "user_id,usage_date" });
  return { allowed: true, todayUsed: todayUsed + 1, monthCostCents: monthCostCents + costCents, limits };
}
