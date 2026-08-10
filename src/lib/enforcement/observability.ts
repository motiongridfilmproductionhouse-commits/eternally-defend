/**
 * Production Enforcement Observability & Operational Alerting Engine.
 * Aggregates worker health, Postmark metrics, route verification stats,
 * enforcement queue counts, and operational alerts.
 */

import { SupabaseClient } from "@supabase/supabase-js";

export interface WorkerHealthMetrics {
  schedulerLastRun?: string | null;
  jobsClaimed: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsRetried: number;
  staleProcessingJobs: number;
}

export interface PostmarkHealthMetrics {
  providerAccepted: number;
  delivered: number;
  bounced: number;
  failed: number;
  webhookHealth: "HEALTHY" | "DEGRADED" | "NO_RECENT_EVENTS";
}

export interface RouteHealthMetrics {
  verified: number;
  unverified: number;
  stale: number;
  routeDiscoveryRequired: number;
}

export interface EnforcementQueueMetrics {
  queued: number;
  submitted: number;
  stillLive: number;
  sourceRemoved: number;
  searchDelisted: number;
  rejected: number;
  humanReviewRequired: number;
}

export interface OperationalAlert {
  id: string;
  severity: "CRITICAL" | "HIGH" | "WARNING" | "INFO";
  title: string;
  message: string;
  createdAt: string;
}

export interface SystemObservabilitySummary {
  worker: WorkerHealthMetrics;
  postmark: PostmarkHealthMetrics;
  routes: RouteHealthMetrics;
  enforcement: EnforcementQueueMetrics;
  activeAlerts: OperationalAlert[];
}

export class EnforcementObservability {
  static async getObservabilitySummary(supabase: SupabaseClient): Promise<SystemObservabilitySummary> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60_000).toISOString();

    const [{ data: jobs }, { data: cases }, { data: routes }, { data: events }] = await Promise.all([
      (supabase as any).from("enforcement_jobs").select("status, attempts, scheduled_at, updated_at").gte("created_at", oneDayAgo),
      (supabase as any).from("enforcement_cases").select("status, created_at"),
      (supabase as any).from("domain_enforcement_routes").select("verification_status"),
      (supabase as any).from("enforcement_events").select("event_type, created_at, metadata").gte("created_at", oneDayAgo),
    ]);

    // 1. Worker Metrics
    let jobsClaimed = 0;
    let jobsCompleted = 0;
    let jobsFailed = 0;
    let jobsRetried = 0;
    let staleProcessingJobs = 0;
    let lastWorkerRun: string | null = null;

    ((jobs as any[]) || []).forEach((j: any) => {
      if (j.status === "processing") jobsClaimed++;
      if (j.status === "completed") jobsCompleted++;
      if (j.status === "failed") jobsFailed++;
      if (j.attempts > 1) jobsRetried++;
      if (j.status === "processing" && String(j.updated_at) < tenMinsAgo) staleProcessingJobs++;
      if (j.updated_at && (!lastWorkerRun || String(j.updated_at) > String(lastWorkerRun))) {
        lastWorkerRun = String(j.updated_at);
      }
    });

    // 2. Postmark Metrics
    let providerAccepted = 0;
    let delivered = 0;
    let bounced = 0;
    let failed = 0;

    (events || []).forEach((e: any) => {
      if (e.event_type === "SUBMITTED" || e.event_type === "PROVIDER_ACCEPTED") providerAccepted++;
      if (e.event_type === "EMAIL_DELIVERED" || e.event_type === "DELIVERED") delivered++;
      if (e.event_type === "EMAIL_HARD_BOUNCE" || e.event_type === "DELIVERY_FAILED") bounced++;
      if (e.event_type === "CONFIGURATION_ERROR" || e.event_type === "FAILED") failed++;
    });

    const webhookHealth: PostmarkHealthMetrics["webhookHealth"] =
      bounced > 5 ? "DEGRADED" : providerAccepted > 0 ? "HEALTHY" : "NO_RECENT_EVENTS";

    // 3. Route Metrics
    let verifiedRoutes = 0;
    let unverifiedRoutes = 0;
    let staleRoutes = 0;
    let routeDiscoveryRequired = 0;

    (routes || []).forEach((r: any) => {
      if (r.verification_status === "VERIFIED") verifiedRoutes++;
      else if (r.verification_status === "STALE") staleRoutes++;
      else if (r.verification_status === "DISCOVERED_UNVERIFIED") unverifiedRoutes++;
      else if (r.verification_status === "ROUTE_DISCOVERY_REQUIRED") routeDiscoveryRequired++;
    });

    // 4. Enforcement Queue Metrics
    let queuedCases = 0;
    let submittedCases = 0;
    let stillLiveCases = 0;
    let sourceRemovedCases = 0;
    let searchDelistedCases = 0;
    let rejectedCases = 0;
    let humanReviewRequired = 0;

    (cases || []).forEach((c: any) => {
      if (c.status === "QUEUED") queuedCases++;
      if (c.status === "SUBMITTED") submittedCases++;
      if (c.status === "STILL_LIVE") stillLiveCases++;
      if (c.status === "SOURCE_REMOVED") sourceRemovedCases++;
      if (c.status === "SEARCH_DELISTED") searchDelistedCases++;
      if (c.status === "REJECTED") rejectedCases++;
      if (c.status === "HUMAN_ACTION_REQUIRED" || c.status === "REVIEW_REQUIRED") humanReviewRequired++;
    });

    // 5. Operational Alerts Generation
    const activeAlerts: OperationalAlert[] = [];

    if (!lastWorkerRun || String(lastWorkerRun) < tenMinsAgo) {
      activeAlerts.push({
        id: "alert-worker-inactive",
        severity: "HIGH",
        title: "Worker Scheduler Inactive",
        message: "No enforcement worker job processed within the last 10 minutes.",
        createdAt: new Date().toISOString(),
      });
    }

    if (bounced > 3 && providerAccepted > 0 && bounced / providerAccepted > 0.15) {
      activeAlerts.push({
        id: "alert-high-bounce-rate",
        severity: "CRITICAL",
        title: "High Email Bounce Rate",
        message: `High bounce rate detected (${bounced} bounces / ${providerAccepted} submissions).`,
        createdAt: new Date().toISOString(),
      });
    }

    if (failed > 0) {
      activeAlerts.push({
        id: "alert-postmark-config-failed",
        severity: "WARNING",
        title: "Postmark Configuration or Provider Errors",
        message: `${failed} outbound email submission failures recorded in the last 24h.`,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      worker: {
        schedulerLastRun: lastWorkerRun,
        jobsClaimed,
        jobsCompleted,
        jobsFailed,
        jobsRetried,
        staleProcessingJobs,
      },
      postmark: {
        providerAccepted,
        delivered,
        bounced,
        failed,
        webhookHealth,
      },
      routes: {
        verified: verifiedRoutes,
        unverified: unverifiedRoutes,
        stale: staleRoutes,
        routeDiscoveryRequired,
      },
      enforcement: {
        queued: queuedCases,
        submitted: submittedCases,
        stillLive: stillLiveCases,
        sourceRemoved: sourceRemovedCases,
        searchDelisted: searchDelistedCases,
        rejected: rejectedCases,
        humanReviewRequired,
      },
      activeAlerts,
    };
  }
}
