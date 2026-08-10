/**
 * Production Rate Limiter & Controlled Production Ceiling Engine.
 * Manages daily client ceilings, domain ceilings, global rate ceilings,
 * bounce/error circuit breakers, and controlled production phase limits.
 */

import { SupabaseClient } from "@supabase/supabase-js";

export interface RateLimitCheckResult {
  allowed: boolean;
  status?: string;
  reason?: string;
}

export class EnforcementRateLimiter {
  // Normal Production Ceilings
  static CLIENT_DAILY_CEILING = 50;
  static DOMAIN_DAILY_CEILING = 10;
  static GLOBAL_DAILY_CEILING = 500;

  // Controlled Production Mode Ceilings (First-Live Phase)
  static CONTROLLED_GLOBAL_DAILY_CEILING = 5;
  static CONTROLLED_CLIENT_DAILY_CEILING = 3;
  static CONTROLLED_DOMAIN_DAILY_CEILING = 1;

  static BOUNCE_RATE_THRESHOLD = 0.15;
  static MAX_HOURLY_PROVIDER_ERRORS = 5;

  static async checkRateLimit(
    supabase: SupabaseClient,
    userId: string,
    domain: string
  ): Promise<RateLimitCheckResult> {
    const isControlledMode = process.env.CONTROLLED_PRODUCTION_MODE === "true";

    const globalCeiling = isControlledMode ? this.CONTROLLED_GLOBAL_DAILY_CEILING : this.GLOBAL_DAILY_CEILING;
    const clientCeiling = isControlledMode ? this.CONTROLLED_CLIENT_DAILY_CEILING : this.CLIENT_DAILY_CEILING;
    const domainCeiling = isControlledMode ? this.CONTROLLED_DOMAIN_DAILY_CEILING : this.DOMAIN_DAILY_CEILING;

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 3600_000).toISOString();

    // 1. Circuit breaker checks
    const { data: recentEvents } = await (supabase as any)
      .from("enforcement_events")
      .select("event_type, created_at")
      .gte("created_at", oneHourAgo);

    let hourlyErrors = 0;
    let totalSubmissions24h = 0;
    let bounces24h = 0;

    (recentEvents || []).forEach((e: any) => {
      if (e.event_type === "CONFIGURATION_ERROR" || e.event_type === "FAILED") hourlyErrors++;
      if (e.event_type === "SUBMITTED" || e.event_type === "PROVIDER_ACCEPTED") totalSubmissions24h++;
      if (e.event_type === "EMAIL_HARD_BOUNCE" || e.event_type === "DELIVERY_FAILED") bounces24h++;
    });

    if (hourlyErrors >= this.MAX_HOURLY_PROVIDER_ERRORS) {
      return {
        allowed: false,
        status: "CIRCUIT_BREAKER_ACTIVE",
        reason: `CIRCUIT_BREAKER_ACTIVE: Provider errors (${hourlyErrors}) exceeded hourly threshold (${this.MAX_HOURLY_PROVIDER_ERRORS}). Auto enforcement paused.`,
      };
    }

    if (totalSubmissions24h > 10 && bounces24h / totalSubmissions24h > this.BOUNCE_RATE_THRESHOLD) {
      return {
        allowed: false,
        status: "CIRCUIT_BREAKER_ACTIVE",
        reason: `CIRCUIT_BREAKER_ACTIVE: Bounce rate (${Math.round((bounces24h / totalSubmissions24h) * 100)}%) exceeded threshold (15%). Auto enforcement paused.`,
      };
    }

    // 2. Global Daily Ceiling Check
    const { count: globalCount } = await (supabase as any)
      .from("enforcement_cases")
      .select("*", { count: "exact", head: true })
      .in("status", ["SUBMITTED", "DELIVERED", "SOURCE_REMOVED", "PROVIDER_ACCEPTED"])
      .gte("created_at", oneDayAgo);

    if ((globalCount || 0) >= globalCeiling) {
      return {
        allowed: false,
        status: isControlledMode ? "QUEUED_FOR_CONTROLLED_RELEASE" : "RATE_LIMIT_EXCEEDED",
        reason: `Global daily submission ceiling (${globalCeiling}) reached in ${isControlledMode ? "Controlled Production" : "Live"} Mode.`,
      };
    }

    // 3. Client Daily Ceiling Check
    const { count: clientCount } = await (supabase as any)
      .from("enforcement_cases")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["SUBMITTED", "DELIVERED", "SOURCE_REMOVED", "PROVIDER_ACCEPTED"])
      .gte("created_at", oneDayAgo);

    if ((clientCount || 0) >= clientCeiling) {
      return {
        allowed: false,
        status: isControlledMode ? "QUEUED_FOR_CONTROLLED_RELEASE" : "RATE_LIMIT_EXCEEDED",
        reason: `Client daily submission ceiling (${clientCeiling}) reached for user ${userId}.`,
      };
    }

    // 4. Domain Daily Ceiling Check
    const { count: domainCount } = await (supabase as any)
      .from("enforcement_cases")
      .select("*", { count: "exact", head: true })
      .eq("domain", domain)
      .in("status", ["SUBMITTED", "DELIVERED", "SOURCE_REMOVED", "PROVIDER_ACCEPTED"])
      .gte("created_at", oneDayAgo);

    if ((domainCount || 0) >= domainCeiling) {
      return {
        allowed: false,
        status: isControlledMode ? "QUEUED_FOR_CONTROLLED_RELEASE" : "RATE_LIMIT_EXCEEDED",
        reason: `Domain daily submission ceiling (${domainCeiling}) reached for ${domain}.`,
      };
    }

    return { allowed: true };
  }
}
