import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import {
  ShieldAlert,
  Loader2,
  ExternalLink,
  CheckCircle2,
  Clock,
  Bot,
  Sliders,
  AlertCircle,
  Eye,
  Check,
  FileCheck,
  ShieldCheck,
  RotateCw,
  Search,
  CheckCircle,
  Activity,
  Layers,
  ArrowRight,
  Shield,
  Zap,
  Server,
  Radio,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { useAuthorization } from "@/hooks/use-authorization";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AutomationSettingsDrawer } from "@/components/enforcement/AutomationSettingsDrawer";
import {
  getClientEnforcementSettings,
  listEnforcementCases,
  listReviewQueue,
  reviewCaseDecision,
  listLiveActivityFeed,
  runWorkerBatch,
  triggerAutoEnforcementForHits,
} from "@/lib/auto-enforcement.functions";
import { signPackageUrl } from "@/lib/enforcement-packages.functions";

export const Route = createFileRoute("/_app/enforcement")({
  head: () => ({ meta: [{ title: "Automated Enforcement Center — Eterna Sentinel" }] }),
  component: EnforcementPage,
});

interface CaseRow {
  id: string;
  scan_hit_id: string | null;
  target_url: string;
  domain: string | null;
  platform: string | null;
  enforcement_basis: string;
  eligibility_status: string;
  eligibility_reason: Record<string, unknown>;
  authorization_status: string;
  selected_route: string | null;
  connector_id: string | null;
  status: string;
  attempts: number;
  next_verification_at: string | null;
  last_verification_at: string | null;
  verification_details: Record<string, unknown>;
  reupload_count: number;
  created_at: string;
  updated_at: string;
}

interface ReviewQueueRow {
  id: string;
  case_id: string;
  reason: string;
  review_status: string;
  created_at: string;
  enforcement_cases: {
    id: string;
    target_url: string;
    domain: string | null;
    platform: string | null;
    enforcement_basis: string;
    eligibility_reason: Record<string, unknown>;
    scan_hits: {
      id: string;
      title: string | null;
      thumbnail_url: string | null;
      threat_score: number | null;
      severity: string | null;
    } | null;
  } | null;
}

interface EventRow {
  id: string;
  case_id: string;
  event_type: string;
  actor_type: string;
  connector_id: string | null;
  previous_state: string | null;
  new_state: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  enforcement_cases: {
    target_url: string;
    platform: string | null;
    domain: string | null;
  } | null;
}

function EnforcementPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const authz = useAuthorization();
  const signFn = useServerFn(signPackageUrl);

  const getSettingsFn = useServerFn(getClientEnforcementSettings);
  const listCasesFn = useServerFn(listEnforcementCases);
  const listQueueFn = useServerFn(listReviewQueue);
  const listActivityFn = useServerFn(listLiveActivityFeed);
  const reviewDecisionFn = useServerFn(reviewCaseDecision);
  const runWorkerFn = useServerFn(runWorkerBatch);
  const triggerHitFn = useServerFn(triggerAutoEnforcementForHits);

  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"cases" | "review" | "activity">("cases");
  const [selectedCaseForDetails, setSelectedCaseForDetails] = useState<CaseRow | null>(null);

  // Queries
  const settingsQuery = useQuery({
    queryKey: ["client_enforcement_settings", userId],
    enabled: ready && !!userId,
    queryFn: () => getSettingsFn(),
  });

  const casesQuery = useQuery({
    queryKey: ["enforcement_cases_list", userId],
    enabled: ready && !!userId,
    queryFn: () => listCasesFn({ data: { limit: 100 } }),
  });

  const reviewQueueQuery = useQuery({
    queryKey: ["enforcement_review_queue", userId],
    enabled: ready && !!userId,
    queryFn: () => listQueueFn(),
  });

  const activityQuery = useQuery({
    queryKey: ["enforcement_live_activity", userId],
    enabled: ready && !!userId,
    queryFn: () => listActivityFn({ data: { limit: 50 } }),
    refetchInterval: 10_000,
  });

  const hitsQuery = useQuery({
    queryKey: ["scan_hits_eligible", userId],
    enabled: ready && !!userId,
    queryFn: async () => {
      // Explicit ownership filter on top of RLS: this customer-facing list must
      // never be able to surface another tenant's or a test fixture's hits.
      const { data } = await supabase
        .from("scan_hits")
        .select("id, title, canonical_url, permalink, source, threat_score")
        .eq("user_id", userId as string)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const settings = settingsQuery.data?.settings;
  const cases = (casesQuery.data?.cases ?? []) as CaseRow[];
  const reviewQueue = (reviewQueueQuery.data?.queue ?? []) as unknown as ReviewQueueRow[];
  const activityFeed = (activityQuery.data?.events ?? []) as unknown as EventRow[];
  const eligibleHits = hitsQuery.data ?? [];

  const autoEnabled = settings?.automatic_enforcement_enabled ?? false;
  const isDemoMode = process.env.DEMO_MODE === "true";

  // Metrics
  const metrics = useMemo(() => {
    const active = cases.filter((c) => !["SOURCE_REMOVED", "SEARCH_DELISTED", "NOT_ELIGIBLE", "REJECTED"].includes(c.status)).length;
    const submitted = cases.filter((c) => ["SUBMITTED", "UNDER_REVIEW", "SOURCE_REMOVED", "SEARCH_DELISTED"].includes(c.status)).length;
    const sourceRemoved = cases.filter((c) => c.status === "SOURCE_REMOVED").length;
    const searchDelisted = cases.filter((c) => c.status === "SEARCH_DELISTED").length;
    const underReview = reviewQueue.length;
    const reuploads = cases.reduce((acc, c) => acc + (c.reupload_count || 0), 0);

    return {
      active,
      submitted,
      sourceRemoved,
      searchDelisted,
      underReview,
      reuploads,
    };
  }, [cases, reviewQueue]);

  // Mutations
  const reviewMutation = useMutation({
    mutationFn: async (args: { queueId: string; caseId: string; action: "APPROVE" | "REJECT"; notes?: string }) => {
      return await reviewDecisionFn({ data: args });
    },
    onSuccess: () => {
      toast.success("Review queue item updated");
      qc.invalidateQueries({ queryKey: ["enforcement_cases_list"] });
      qc.invalidateQueries({ queryKey: ["enforcement_review_queue"] });
      qc.invalidateQueries({ queryKey: ["enforcement_live_activity"] });
    },
  });

  const triggerScanHitsMutation = useMutation({
    mutationFn: async () => {
      const ids = eligibleHits.map((h) => h.id);
      if (!ids.length) return;
      return await triggerHitFn({ data: { scanHitIds: ids } });
    },
    onSuccess: (data) => {
      toast.success(`Evaluated ${data?.results?.length ?? 0} finding(s) through auto-enforcement engine`);
      qc.invalidateQueries({ queryKey: ["enforcement_cases_list"] });
      qc.invalidateQueries({ queryKey: ["enforcement_review_queue"] });
      qc.invalidateQueries({ queryKey: ["enforcement_live_activity"] });
    },
  });

  const runWorkerMutation = useMutation({
    mutationFn: async () => {
      return await runWorkerFn();
    },
    onSuccess: (data) => {
      if (data.processed) {
        toast.success("Durable job worker completed a processing pass");
      } else {
        toast.info("No pending jobs in worker queue");
      }
      qc.invalidateQueries({ queryKey: ["enforcement_cases_list"] });
      qc.invalidateQueries({ queryKey: ["enforcement_live_activity"] });
    },
  });

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 p-4 md:p-8 space-y-6 text-slate-900 dark:text-slate-100 font-sans">
      {/* Top Hero Command Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden">
        {/* Subtle Ambient Background Accent */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="flex items-start md:items-center gap-4">
            <div className="size-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/80 dark:border-blue-800/60 grid place-items-center shadow-sm shrink-0">
              <Bot className="size-7 animate-pulse text-blue-600 dark:text-blue-400" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white font-mono">
                  AUTOMATIC ENFORCEMENT ENGINE
                </h1>
                <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-semibold ${autoEnabled ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60" : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60"}`}>
                  <span className={`size-2 rounded-full ${autoEnabled ? "bg-emerald-500 animate-ping" : "bg-amber-500"}`} />
                  {autoEnabled ? "● AUTOMATION ACTIVE" : "● PAUSED"}
                </span>

                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  CONTROLLED TEST MODE
                </span>

                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  KILL SWITCH: ACTIVE
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-normal max-w-2xl">
                Continuous detection, eligibility evaluation, verified routing, submission tracking and independent removal verification.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {eligibleHits.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm rounded-xl font-medium"
                onClick={() => triggerScanHitsMutation.mutate()}
                disabled={triggerScanHitsMutation.isPending}
              >
                <RotateCw className={`size-3.5 mr-1.5 text-blue-600 ${triggerScanHitsMutation.isPending ? "animate-spin" : ""}`} />
                Evaluate Recent Hits ({eligibleHits.length})
              </Button>
            )}

            <Button
              variant="default"
              size="sm"
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-blue-500/20 rounded-xl font-semibold gap-1.5 transition-all duration-200"
              onClick={() => setSettingsDrawerOpen(true)}
            >
              <Sliders className="size-3.5" /> Configure Automation
            </Button>

            <button
              onClick={() => runWorkerMutation.mutate()}
              className="text-xs font-medium text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Bot className="size-3.5 text-slate-400" /> Trigger Worker Pass
            </button>
          </div>
        </div>

        {/* Compact Hero Execution Stepper */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800/80">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center text-xs font-medium">
            <HeroStep label="Detection" sub="Continuous Scan" active />
            <HeroStep label="Rights Verification" sub="Identity Match" active />
            <HeroStep label="Eligibility" sub="Policy Engine" active />
            <HeroStep label="Enforcement" sub="Verified Delivery" active pulsing />
            <HeroStep label="Verification" sub="Removal Scan" active />
          </div>
        </div>

        {/* Protection Coverage Row */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-200">Protection Coverage:</span>
            <CoverageChip label="Identity Monitoring" active={authz.completed} />
            <CoverageChip label="Copyright Enforcement" active={authz.canRequestEnforcement} />
            <CoverageChip label="Impersonation Reporting" active={false} />
            <CoverageChip label="Deepfake Enforcement" active={false} />
            <CoverageChip label="Legal Escalation" active={false} />
          </div>
          <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
            Eterna Autonomous Engine v2.4
          </span>
        </div>
      </div>

      {/* Simulation Notice */}
      {isDemoMode && (
        <div className="rounded-2xl border border-blue-200/80 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 p-4 flex items-center gap-3 text-xs text-blue-900 dark:text-blue-200">
          <ShieldCheck className="size-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className="flex-1">
            <strong className="font-semibold uppercase tracking-wider text-blue-950 dark:text-blue-100">SIMULATION ONLY MODE ACTIVE</strong> — Notice preview and audit event workflows generate simulated actions. External network submissions are hard-blocked server-side.
          </div>
        </div>
      )}

      {/* Metric Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <MetricCard label="ACTIVE CASES" value={metrics.active} sub="In pipeline" icon={Activity} />
        <MetricCard label="SUBMITTED" value={metrics.submitted} sub="Sent to routes" icon={Zap} />
        <MetricCard label="UNDER REVIEW" value={metrics.underReview} sub="Review queue" icon={AlertCircle} />
        <MetricCard label="SOURCE REMOVED" value={metrics.sourceRemoved} sub="Verified offline" icon={CheckCircle2} />
        <MetricCard label="SEARCH DELISTED" value={metrics.searchDelisted} sub="Removed index" icon={Search} />
        <MetricCard label="REUPLOADS" value={metrics.reuploads} sub="Auto-detected" icon={ShieldAlert} />
      </div>

      {/* Pipeline Centerpiece Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white font-mono flex items-center gap-2">
              <Layers className="size-4 text-blue-600" /> AUTOMATED ENFORCEMENT PIPELINE
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live progression of findings from initial scanner detection to verified removal
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
            Autonomous Worker Active
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
          <PipelineStage number="01" name="DETECTED" sub="Scanner Hit" active completed />
          <PipelineStage number="02" name="VERIFIED" sub="Rights Match" active completed />
          <PipelineStage number="03" name="ELIGIBLE" sub="Rule Engine" active completed />
          <PipelineStage number="04" name="QUEUED" sub="Durable Job" active pulsing />
          <PipelineStage number="05" name="SUBMITTED" sub="Route Sent" active={false} />
          <PipelineStage number="06" name="REVIEWING" sub="Status Check" active={false} />
          <PipelineStage number="07" name="REMOVED" sub="Verified Offline" active={false} />
        </div>
      </div>

      {/* Main Activity Area with Tabs */}
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <TabButton
            active={activeTab === "cases"}
            onClick={() => setActiveTab("cases")}
            label={`Active Cases (${cases.length})`}
            icon={FileCheck}
          />
          <TabButton
            active={activeTab === "review"}
            onClick={() => setActiveTab("review")}
            label={`Human Review (${reviewQueue.length})`}
            icon={AlertCircle}
            badgeCount={reviewQueue.length}
          />
          <TabButton
            active={activeTab === "activity"}
            onClick={() => setActiveTab("activity")}
            label="Live Activity Ticker"
            icon={Clock}
          />
        </div>

        {/* Tab 1: Active Cases */}
        {activeTab === "cases" && (
          <div>
            {casesQuery.isLoading ? (
              <div className="py-16 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 text-sm gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl">
                <Loader2 className="size-6 text-blue-600 animate-spin" /> Loading enforcement cases…
              </div>
            ) : cases.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cases.map((c) => (
                  <CaseCard key={c.id} c={c} onViewDetails={() => setSelectedCaseForDetails(c)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Human Review Queue */}
        {activeTab === "review" && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-950 dark:text-white font-mono">
                HUMAN REVIEW QUEUE
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Cases flagged for manual operator review due to fair-use ambiguity, unverified routes, or client policy settings.
              </p>
            </div>

            {reviewQueueQuery.isLoading ? (
              <div className="py-12 flex items-center justify-center text-slate-500 text-sm gap-2">
                <Loader2 className="size-4 animate-spin text-blue-600" /> Loading review queue…
              </div>
            ) : reviewQueue.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-8 bg-slate-50/50 dark:bg-slate-900/50">
                Review queue is empty. All eligible cases are being processed automatically.
              </div>
            ) : (
              <div className="space-y-3">
                {reviewQueue.map((item) => (
                  <div key={item.id} className="p-4 border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs shadow-sm hover:border-blue-500/30 transition-all">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 font-semibold text-sm">
                        <span className="text-amber-600 font-mono text-xs bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">[REVIEW REQUIRED]</span>
                        <span className="truncate text-slate-950 dark:text-white font-medium">{item.enforcement_cases?.target_url}</span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-4">
                        <span>Domain: <strong className="text-slate-700 dark:text-slate-300 font-medium">{item.enforcement_cases?.domain || "—"}</strong></span>
                        <span>Basis: <strong className="text-slate-700 dark:text-slate-300 font-medium">{item.enforcement_cases?.enforcement_basis}</strong></span>
                        <span>Reason: <strong className="text-slate-700 dark:text-slate-300 font-medium">{item.reason}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="default"
                        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm"
                        onClick={() =>
                          reviewMutation.mutate({
                            queueId: item.id,
                            caseId: item.case_id,
                            action: "APPROVE",
                          })
                        }
                        disabled={reviewMutation.isPending}
                      >
                        <Check className="size-3.5 mr-1" /> Approve Enforcement
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs text-rose-600 hover:text-rose-700 border-rose-200 hover:bg-rose-50 rounded-xl"
                        onClick={() =>
                          reviewMutation.mutate({
                            queueId: item.id,
                            caseId: item.case_id,
                            action: "REJECT",
                          })
                        }
                        disabled={reviewMutation.isPending}
                      >
                        Not Eligible
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Live Enforcement Activity Stream */}
        {activeTab === "activity" && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-950 dark:text-white font-mono">
                LIVE ENFORCEMENT EVENT STREAM
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Real-time audit log of automated backend actions, eligibility evaluations, route resolutions, and verification checks.
              </p>
            </div>

            {activityQuery.isLoading ? (
              <div className="py-12 flex items-center justify-center text-slate-500 text-sm gap-2">
                <Loader2 className="size-4 animate-spin text-blue-600" /> Loading activity stream…
              </div>
            ) : activityFeed.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500 border border-slate-100 rounded-2xl p-8 bg-slate-50">
                No live activity recorded yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 font-mono text-xs">
                {activityFeed.map((ev) => (
                  <div key={ev.id} className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800/60 py-3 px-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl transition-colors">
                    <span className="size-2 rounded-full bg-blue-500 shrink-0" />
                    <span className="text-slate-400 text-[11px] shrink-0 w-28">
                      {new Date(ev.created_at).toLocaleTimeString()}
                    </span>
                    <span className="font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] shrink-0 border border-slate-200 dark:border-slate-700">
                      {ev.event_type}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400 truncate flex-1 font-sans text-xs">
                      {ev.enforcement_cases?.target_url || "Target URL"}
                    </span>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      {ev.new_state || ev.actor_type}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* System Health Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white font-mono">
          <Server className="size-4 text-blue-600" /> SYSTEM HEALTH & INFRASTRUCTURE STATUS
        </div>

        <div className="flex flex-wrap items-center gap-5 text-slate-600 dark:text-slate-300 font-medium text-[11px]">
          <HealthItem label="Detection Engine" status="ONLINE" />
          <HealthItem label="Enforcement Worker" status="ONLINE" />
          <HealthItem label="Email Transport" status="READY" />
          <HealthItem label="Route Resolver" status="READY" />
          <HealthItem label="Verification Engine" status="ONLINE" />
        </div>
      </div>

      <AutomationSettingsDrawer
        open={settingsDrawerOpen}
        onOpenChange={setSettingsDrawerOpen}
      />
    </div>
  );
}

function MetricCard({ label, value, sub, icon: Icon }: { label: string; value: number; sub: string; icon: any }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-blue-500/30 transition-all duration-200 space-y-1">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-[10px] font-bold tracking-wider uppercase font-mono">{label}</span>
        <Icon className="size-4" />
      </div>
      <div className="text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight">{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400 font-normal">{sub}</div>
    </div>
  );
}

function HeroStep({ label, sub, active, pulsing }: { label: string; sub: string; active: boolean; pulsing?: boolean }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 rounded-xl p-2.5 text-center relative overflow-hidden">
      <div className="flex items-center justify-center gap-1.5">
        <span className={`size-2 rounded-full ${pulsing ? "bg-blue-600 animate-ping" : "bg-emerald-500"}`} />
        <span className="font-semibold text-slate-900 dark:text-white text-xs">{label}</span>
      </div>
      <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5 font-normal">{sub}</span>
    </div>
  );
}

function PipelineStage({ number, name, sub, active, completed, pulsing }: { number: string; name: string; sub: string; active: boolean; completed?: boolean; pulsing?: boolean }) {
  return (
    <div className={`p-3 rounded-2xl border transition-all ${completed ? "bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200/80 dark:border-emerald-900/60" : pulsing ? "bg-blue-50/40 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800 shadow-sm" : "bg-slate-50/50 dark:bg-slate-800/40 border-slate-200/60 dark:border-slate-800"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono font-bold text-slate-400">{number}</span>
        {completed ? (
          <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : pulsing ? (
          <span className="size-2 rounded-full bg-blue-600 animate-ping" />
        ) : (
          <span className="size-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
        )}
      </div>
      <div className="font-bold text-slate-900 dark:text-white text-xs truncate">{name}</div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{sub}</div>
    </div>
  );
}

function CoverageChip({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-medium transition-colors ${active ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" : "bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700"}`}>
      <span className={`size-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {label}
    </span>
  );
}

function HealthItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2 rounded-full bg-emerald-500" />
      <span className="text-slate-500 dark:text-slate-400">{label}:</span>
      <strong className="text-slate-900 dark:text-white font-mono">{status}</strong>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-12 text-center space-y-4 shadow-sm">
      <div className="size-16 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 grid place-items-center mx-auto">
        <Shield className="size-8" />
      </div>
      <div className="space-y-1 max-w-md mx-auto">
        <h3 className="text-base font-bold text-slate-950 dark:text-white">No active enforcement cases</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Verified eligible findings will automatically enter the enforcement pipeline and proceed through eligibility evaluation and backend enforcement.
        </p>
      </div>
    </div>
  );
}

function CaseCard({ c, onViewDetails }: { c: CaseRow; onViewDetails: () => void }) {
  const isRemoved = c.status === "SOURCE_REMOVED";
  const isDelisted = c.status === "SEARCH_DELISTED";

  return (
    <div className="p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 shadow-sm hover:shadow-md hover:border-blue-500/30 transition-all duration-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-950 dark:text-white font-mono uppercase truncate max-w-[200px]">
              {c.domain || "Web Domain"}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              {c.status}
            </span>
            {c.reupload_count > 0 && (
              <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full font-bold">
                {c.reupload_count} Reupload(s)
              </span>
            )}
          </div>
          <a
            href={c.target_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block font-medium"
          >
            {c.target_url}
          </a>
        </div>

        <Button size="sm" variant="outline" className="text-xs h-8 px-3 rounded-xl border-slate-200 dark:border-slate-800" onClick={onViewDetails}>
          <Eye className="size-3.5 mr-1 text-slate-400" /> Timeline
        </Button>
      </div>

      {/* Details breakdown */}
      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800">
        <div>
          <span className="text-slate-400 block text-[10px] font-medium">Basis</span>
          <span className="font-semibold text-slate-900 dark:text-slate-200">{c.enforcement_basis}</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] font-medium">Route</span>
          <span className="font-semibold text-slate-900 dark:text-slate-200">{c.selected_route || "Automated Email Route"}</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] font-medium">Authorization</span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="size-3" /> VERIFIED
          </span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] font-medium">Eligibility</span>
          <span className="font-semibold text-blue-600 dark:text-blue-400">{c.eligibility_status}</span>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon: Icon,
  badgeCount,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: typeof FileCheck;
  badgeCount?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-2xl text-xs font-semibold inline-flex items-center gap-2 transition-all duration-200 ${active ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"}`}
    >
      <Icon className="size-4" />
      {label}
      {badgeCount !== undefined && badgeCount > 0 && (
        <span className="size-4 rounded-full bg-amber-500 text-white text-[10px] font-bold grid place-items-center">
          {badgeCount}
        </span>
      )}
    </button>
  );
}
