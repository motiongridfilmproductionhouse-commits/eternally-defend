import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Single source of truth for the account-level protection posture.
 *
 * Every header pill, dashboard stat card and "action required" surface must read
 * from this function. Before it existed, TopBar, StatsRow and the Command Center
 * each recomputed the same numbers with different filters (including a lowercase
 * `status = "open"` cases filter that can never match the stored "Open"), so the
 * same account showed three different truths on one screen.
 */

export type ActionRequiredItem = {
  key: string;
  label: string;
  detail: string;
  /** Route the operator should go to in order to clear this item. */
  to: string;
  count: number;
  tone: "critical" | "warning" | "info";
};

export type ProtectionSummary = {
  assets: number;
  /** Critical + High severity, non-hidden detections. */
  criticalThreats: number;
  openCases: number;
  criticalCases: number;
  /** Enforcement requests recorded but never handed to a transport. */
  queuedEnforcement: number;
  /** Queued for more than 24h — nothing is going to pick these up on its own. */
  stalledEnforcement: number;
  takedownsSent: number;
  /** Critical/High detections with no case attached yet. */
  unlinkedCriticalFindings: number;
  actionRequired: ActionRequiredItem[];
  level: "protected" | "monitoring" | "at-risk" | "critical";
  label: string;
};

const OPEN_CASE_STATUSES = ["Open", "In Progress", "Escalated"] as const;
const HIGH_SEVERITIES = ["Critical", "High"] as const;

export const getProtectionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProtectionSummary> => {
    const { supabase, userId } = context;
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

    const [assetsRes, threatsRes, casesRes, criticalCasesRes, queuedRes, stalledRes, sentRes] =
      await Promise.all([
        supabase
          .from("protected_assets")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabase
          .from("scan_hits")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("hidden_at", null)
          .in("severity", HIGH_SEVERITIES as unknown as string[]),
        supabase
          .from("cases")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("status", OPEN_CASE_STATUSES as unknown as string[]),
        supabase
          .from("cases")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("status", OPEN_CASE_STATUSES as unknown as string[])
          .in("priority", HIGH_SEVERITIES as unknown as string[]),
        supabase
          .from("enforcement_requests")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "Queued"),
        supabase
          .from("enforcement_requests")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "Queued")
          .lt("created_at", dayAgo),
        supabase
          .from("enforcement_requests")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .neq("status", "Queued"),
      ]);

    const [openHits, linked] = await Promise.all([
      supabase
        .from("scan_hits")
        .select("id")
        .eq("user_id", userId)
        .is("hidden_at", null)
        .in("severity", HIGH_SEVERITIES as unknown as string[])
        .limit(2000),
      supabase.from("case_findings").select("scan_hit_id").eq("user_id", userId).limit(5000),
    ]);

    const linkedIds = new Set(
      (linked.data ?? []).map((r) => r.scan_hit_id).filter((v): v is string => !!v),
    );
    const unlinkedCriticalFindings = (openHits.data ?? []).filter((h) => !linkedIds.has(h.id))
      .length;

    const assets = assetsRes.count ?? 0;
    const criticalThreats = threatsRes.count ?? 0;
    const openCases = casesRes.count ?? 0;
    const criticalCases = criticalCasesRes.count ?? 0;
    const queuedEnforcement = queuedRes.count ?? 0;
    const stalledEnforcement = stalledRes.count ?? 0;
    const takedownsSent = sentRes.count ?? 0;

    const actionRequired: ActionRequiredItem[] = [];
    if (assets === 0) {
      actionRequired.push({
        key: "no-assets",
        label: "Register a protected asset",
        detail: "Monitoring only runs against assets registered to your account.",
        to: "/assets",
        count: 0,
        tone: "warning",
      });
    }
    if (unlinkedCriticalFindings > 0) {
      actionRequired.push({
        key: "unlinked-findings",
        label: `${unlinkedCriticalFindings} high-severity detections without a case`,
        detail: "Promote them to cases so enforcement and evidence stay traceable.",
        to: "/cases",
        count: unlinkedCriticalFindings,
        tone: "critical",
      });
    }
    if (stalledEnforcement > 0) {
      actionRequired.push({
        key: "stalled-enforcement",
        label: `${stalledEnforcement} enforcement requests queued over 24h`,
        detail: "These were recorded but never submitted to a platform or transport.",
        to: "/removals",
        count: stalledEnforcement,
        tone: "critical",
      });
    } else if (queuedEnforcement > 0) {
      actionRequired.push({
        key: "queued-enforcement",
        label: `${queuedEnforcement} enforcement requests awaiting submission`,
        detail: "Queued requests are recorded only — nothing has been sent yet.",
        to: "/removals",
        count: queuedEnforcement,
        tone: "warning",
      });
    }
    if (criticalCases > 0) {
      actionRequired.push({
        key: "critical-cases",
        label: `${criticalCases} critical/high cases open`,
        detail: "Review and progress these before they age out.",
        to: "/cases",
        count: criticalCases,
        tone: "warning",
      });
    }

    const level: ProtectionSummary["level"] = actionRequired.some((a) => a.tone === "critical")
      ? "critical"
      : criticalThreats > 0 || openCases > 0
        ? "at-risk"
        : assets > 0
          ? "protected"
          : "monitoring";

    const label =
      level === "critical"
        ? "Action Required"
        : level === "at-risk"
          ? "At Risk"
          : level === "protected"
            ? "Protected"
            : "Monitoring";

    return {
      assets,
      criticalThreats,
      openCases,
      criticalCases,
      queuedEnforcement,
      stalledEnforcement,
      takedownsSent,
      unlinkedCriticalFindings,
      actionRequired,
      level,
      label,
    };
  });
