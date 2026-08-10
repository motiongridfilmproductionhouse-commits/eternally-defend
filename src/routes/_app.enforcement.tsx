import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
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
  X,
  FileCheck,
  ShieldCheck,
  RotateCw,
  Search,
  CheckCircle,
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
  head: () => ({ meta: [{ title: "Automated Enforcement Center — Eterna AI" }] }),
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
      const { data } = await supabase
        .from("scan_hits")
        .select("id, title, canonical_url, permalink, source, threat_score")
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
    <div className="space-y-6">
      {/* Top Status Banner: AUTOMATIC PROTECTION */}
      <div className={`rounded-2xl border p-5 transition-all ${autoEnabled ? "border-emerald-500/40 bg-emerald-950/20" : "border-amber-500/40 bg-amber-950/20"}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className={`size-12 rounded-2xl grid place-items-center ${autoEnabled ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
              <Bot className="size-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold tracking-tight">AUTOMATIC ENFORCEMENT ENGINE</h1>
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full font-semibold ${autoEnabled ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/20 text-amber-300 border border-amber-500/30"}`}>
                  <span className={`size-2 rounded-full ${autoEnabled ? "bg-emerald-400 animate-ping" : "bg-amber-400"}`} />
                  {autoEnabled ? "ACTIVE" : "PAUSED"}
                </span>
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  TEST MODE ACTIVE
                </span>
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  KILL SWITCH: ACTIVE
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automated eligibility evaluation, route resolution, Postmark email delivery, and independent removal verification. Controlled Test Mode enabled. Real third-party contacts blocked.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {eligibleHits.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => triggerScanHitsMutation.mutate()}
                disabled={triggerScanHitsMutation.isPending}
              >
                <RotateCw className={`size-3.5 mr-1.5 ${triggerScanHitsMutation.isPending ? "animate-spin" : ""}`} />
                Evaluate Recent Hits ({eligibleHits.length})
              </Button>
            )}

            <Button
              variant="default"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => setSettingsDrawerOpen(true)}
            >
              <Sliders className="size-3.5" /> Configure Automation
            </Button>
          </div>
        </div>

        {/* Granular Scope Badges */}
        <div className="mt-4 pt-3 border-t border-border/40 flex flex-wrap items-center justify-between text-xs gap-2">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className="font-semibold text-foreground">Rights Authorization:</span>
            <ScopeChip label="IDENTITY MONITORING" active={authz.completed} />
            <ScopeChip label="COPYRIGHT ENFORCEMENT" active={authz.canRequestEnforcement} />
            <ScopeChip label="IMPERSONATION REPORTING" active={authz.canRequestEnforcement} />
            <ScopeChip label="DEEPFAKE ENFORCEMENT" active={authz.canRequestEnforcement} />
            <ScopeChip label="LEGAL ESCALATION" active={authz.canTakedown} />
          </div>

          <button
            onClick={() => runWorkerMutation.mutate()}
            className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <Bot className="size-3" /> Trigger Worker Pass
          </button>
        </div>
      </div>

      {/* Demo Mode Notice */}
      {isDemoMode && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-950/30 p-3.5 flex items-center gap-3 text-xs text-blue-200">
          <ShieldCheck className="size-5 text-blue-400 shrink-0" />
          <div className="flex-1">
            <strong className="font-bold uppercase tracking-wider">SIMULATION ONLY MODE ACTIVE</strong> — Notice preview and audit event workflows generate simulated actions. External network submissions are hard-blocked server-side.
          </div>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="ACTIVE CASES" value={metrics.active} sub="In pipeline" accent="oklch(0.65 0.18 240)" />
        <StatCard label="SUBMITTED" value={metrics.submitted} sub="Sent to routes" accent="oklch(0.68 0.16 155)" />
        <StatCard label="UNDER REVIEW" value={metrics.underReview} sub="Review queue" accent="oklch(0.75 0.18 75)" />
        <StatCard label="SOURCE REMOVED" value={metrics.sourceRemoved} sub="Verified offline" accent="oklch(0.68 0.20 140)" />
        <StatCard label="SEARCH DELISTED" value={metrics.searchDelisted} sub="Removed from index" accent="oklch(0.60 0.18 220)" />
        <StatCard label="REUPLOADS" value={metrics.reuploads} sub="Auto-detected" accent="oklch(0.63 0.24 25)" />
      </div>

      {/* Live Pipeline Stepper Header */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center justify-between">
          <span>Automated Enforcement Pipeline Workflow</span>
          <span className="text-[10px] text-muted-foreground lowercase">server-side background execution</span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium">
          <PipelineStep label="1. DETECTED" desc="Scanner Hit" active />
          <PipelineStep label="2. VERIFIED" desc="Rights Match" active />
          <PipelineStep label="3. ELIGIBLE" desc="Rule Engine" active />
          <PipelineStep label="4. QUEUED" desc="Durable Job" active />
          <PipelineStep label="5. SUBMITTED" desc="Route Sent" active />
          <PipelineStep label="6. REVIEWING" desc="Status Check" active />
          <PipelineStep label="7. REMOVED" desc="Verified Offline" active />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <TabButton
          active={activeTab === "cases"}
          onClick={() => setActiveTab("cases")}
          label={`Active Cases (${cases.length})`}
          icon={FileCheck}
        />
        <TabButton
          active={activeTab === "review"}
          onClick={() => setActiveTab("review")}
          label={`Human Review Queue (${reviewQueue.length})`}
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
        <div className="space-y-4">
          {casesQuery.isLoading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground text-sm gap-2">
              <Loader2 className="size-5 animate-spin" /> Loading automated cases…
            </div>
          ) : cases.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground border border-border rounded-2xl p-8">
              No active automated enforcement cases. New verified scanner findings will automatically trigger eligibility evaluation and backend enforcement.
            </div>
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
        <PageCard title="HUMAN REVIEW QUEUE" sub="Cases flagged for operator evaluation (fair-use, copyright ambiguity, manual settings)">
          {reviewQueueQuery.isLoading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading review queue…
            </div>
          ) : reviewQueue.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Review queue is empty. All eligible cases are being processed automatically.
            </div>
          ) : (
            <div className="space-y-3">
              {reviewQueue.map((item) => (
                <div key={item.id} className="p-4 border border-border rounded-xl bg-card/60 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <span className="text-amber-400 font-mono">[REVIEW REQUIRED]</span>
                      <span className="truncate">{item.enforcement_cases?.target_url}</span>
                    </div>
                    <div className="text-muted-foreground flex flex-wrap gap-x-4">
                      <span>Domain: {item.enforcement_cases?.domain || "—"}</span>
                      <span>Basis: {item.enforcement_cases?.enforcement_basis}</span>
                      <span>Reason: {item.reason}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      className="text-xs bg-emerald-600 hover:bg-emerald-500"
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
                      className="text-xs text-rose-400 hover:text-rose-300"
                      onClick={() =>
                        reviewMutation.mutate({
                          queueId: item.id,
                          caseId: item.case_id,
                          action: "REJECT",
                        })
                      }
                      disabled={reviewMutation.isPending}
                    >
                      <X className="size-3.5 mr-1" /> Not Eligible
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PageCard>
      )}

      {/* Tab 3: Live Enforcement Activity */}
      {activeTab === "activity" && (
        <PageCard title="LIVE ENFORCEMENT ACTIVITY TICKER" sub="Real-time audit log of automated backend actions, eligibility evaluations, and status checks">
          {activityQuery.isLoading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground text-sm gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading activity stream…
            </div>
          ) : activityFeed.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No live activity recorded yet.
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {activityFeed.map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 text-xs border-b border-border/40 py-2.5 px-2 hover:bg-accent/20 rounded-lg">
                  <Clock className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground font-mono text-[11px] shrink-0 w-36">
                    {new Date(ev.created_at).toLocaleTimeString()}
                  </span>
                  <span className="font-semibold px-2 py-0.5 rounded bg-muted text-[11px] shrink-0">
                    {ev.event_type}
                  </span>
                  <span className="text-muted-foreground truncate flex-1">
                    {ev.enforcement_cases?.target_url || "Target URL"}
                  </span>
                  <Pill color={statusColor(ev.new_state || ev.event_type)}>
                    {ev.new_state || ev.actor_type}
                  </Pill>
                </div>
              ))}
            </div>
          )}
        </PageCard>
      )}

      <AutomationSettingsDrawer
        open={settingsDrawerOpen}
        onOpenChange={setSettingsDrawerOpen}
      />
    </div>
  );
}

function CaseCard({ c, onViewDetails }: { c: CaseRow; onViewDetails: () => void }) {
  const isRemoved = c.status === "SOURCE_REMOVED";
  const isDelisted = c.status === "SEARCH_DELISTED";

  return (
    <div className="p-4 rounded-2xl border border-border bg-card/70 space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-foreground font-mono uppercase truncate max-w-[200px]">
              {c.domain || "Web Domain"}
            </span>
            <Pill color={statusColor(c.status)}>{c.status}</Pill>
            {c.reupload_count > 0 && (
              <span className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full font-bold">
                {c.reupload_count} Reupload(s)
              </span>
            )}
          </div>
          <a
            href={c.target_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary underline truncate block"
          >
            {c.target_url}
          </a>
        </div>

        <Button size="sm" variant="outline" className="text-xs h-8 px-2.5" onClick={onViewDetails}>
          <Eye className="size-3.5 mr-1" /> Timeline
        </Button>
      </div>

      {/* Details breakdown */}
      <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-xl">
        <div>
          <span className="text-muted-foreground block text-[10px]">Basis</span>
          <span className="font-semibold text-foreground">{c.enforcement_basis}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px]">Route</span>
          <span className="font-semibold text-foreground">{c.selected_route || "Automated Email Route"}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px]">Authorization</span>
          <span className="font-semibold text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="size-3" /> VERIFIED
          </span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px]">Eligibility</span>
          <span className="font-semibold text-primary">{c.eligibility_status}</span>
        </div>
      </div>

      {/* Pipeline Stepper */}
      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold">
          <span>AUTO ENFORCEMENT PROGRESS</span>
          <span>{isRemoved ? "100%" : isDelisted ? "85%" : "60%"}</span>
        </div>
        <div className="grid grid-cols-6 gap-1">
          <StepperDot step="DETECT" done />
          <StepperDot step="VERIFY" done />
          <StepperDot step="ELIGIBLE" done />
          <StepperDot step="SUBMIT" done={["SUBMITTED", "SOURCE_REMOVED", "SEARCH_DELISTED"].includes(c.status)} />
          <StepperDot step="REVIEW" done={["SOURCE_REMOVED", "SEARCH_DELISTED"].includes(c.status)} />
          <StepperDot step="REMOVED" done={isRemoved || isDelisted} />
        </div>
      </div>
    </div>
  );
}

function StepperDot({ step, done }: { step: string; done: boolean }) {
  return (
    <div className="space-y-1 text-center">
      <div className={`h-1.5 rounded-full ${done ? "bg-emerald-400" : "bg-muted"}`} />
      <span className={`text-[9px] block ${done ? "text-emerald-300 font-semibold" : "text-muted-foreground"}`}>
        {step}
      </span>
    </div>
  );
}

function PipelineStep({ label, desc, active }: { label: string; desc: string; active: boolean }) {
  return (
    <div className="p-2 rounded-xl border border-border bg-muted/30">
      <div className="font-bold text-foreground truncate">{label}</div>
      <div className="text-muted-foreground text-[10px] truncate">{desc}</div>
    </div>
  );
}

function ScopeChip({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border font-semibold ${active ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}>
      {active ? "✓" : "✕"} {label}
    </span>
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
      className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"}`}
    >
      <Icon className="size-4" />
      {label}
      {badgeCount !== undefined && badgeCount > 0 && (
        <span className="size-4 rounded-full bg-amber-400 text-black text-[10px] font-bold grid place-items-center">
          {badgeCount}
        </span>
      )}
    </button>
  );
}

function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (s.includes("REMOVED") || s.includes("ACCEPTED") || s.includes("DELISTED")) return "oklch(0.68 0.20 140)";
  if (s.includes("SUBMITTED") || s.includes("QUEUED") || s.includes("SENT")) return "oklch(0.65 0.18 240)";
  if (s.includes("REVIEW") || s.includes("PENDING")) return "oklch(0.75 0.18 75)";
  if (s.includes("FAILED") || s.includes("REJECTED")) return "oklch(0.63 0.24 25)";
  return "oklch(0.60 0.10 250)";
}
