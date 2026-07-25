import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  runDeepfakeScan,
  listDeepfakeScans,
  getDeepfakeScan,
  updateDeepfakeFinding,
  getDeepfakeTargetSuggestion,
} from "@/lib/deepfake-intel.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ScanFace, ShieldAlert, ExternalLink, Loader2, AlertTriangle,
  CheckCircle2, XCircle, Filter, Radar,
} from "lucide-react";

export const Route = createFileRoute("/_app/deepfake-intel")({
  head: () => ({
    meta: [
      { title: "Deepfake & Synthetic Media Intelligence — Eterna" },
      { name: "description", content: "Scan the public web for deepfakes, AI-generated intimate imagery, face swaps, and synthetic media targeting protected identities." },
      { property: "og:title", content: "Deepfake & Synthetic Media Intelligence — Eterna" },
      { property: "og:description", content: "Cautious, evidence-graded intelligence sweeps for deepfake and synthetic media abuse." },
    ],
  }),
  component: DeepfakeIntelPage,
});

type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

const RISK_STYLE: Record<RiskLevel, { badge: string; dot: string }> = {
  CRITICAL: { badge: "bg-red-600/15 text-red-500 border-red-600/40", dot: "bg-red-500" },
  HIGH:     { badge: "bg-orange-500/15 text-orange-400 border-orange-500/40", dot: "bg-orange-400" },
  MEDIUM:   { badge: "bg-amber-400/15 text-amber-400 border-amber-400/40", dot: "bg-amber-400" },
  LOW:      { badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40", dot: "bg-emerald-400" },
};

function DeepfakeIntelPage() {
  const runFn = useServerFn(runDeepfakeScan);
  const listFn = useServerFn(listDeepfakeScans);
  const getFn = useServerFn(getDeepfakeScan);
  const updFn = useServerFn(updateDeepfakeFinding);
  const suggestFn = useServerFn(getDeepfakeTargetSuggestion);
  const qc = useQueryClient();

  const suggest = useQuery({
    queryKey: ["deepfake-target-suggest"],
    queryFn: () => suggestFn({}),
    staleTime: 60_000,
  });

  const [targetName, setTargetName] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [handlesText, setHandlesText] = useState("");
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<"ALL" | RiskLevel>("ALL");

  useEffect(() => {
    if (!targetName && suggest.data?.target_name) {
      setTargetName(suggest.data.target_name);
    }
  }, [suggest.data, targetName]);

  const scans = useQuery({
    queryKey: ["deepfake-scans"],
    queryFn: () => listFn({}),
    refetchInterval: (q) => {
      const data = q.state.data as Array<{ status: string }> | undefined;
      return data?.some((s) => s.status === "running") ? 3_000 : false;
    },
  });

  const selected = useQuery({
    queryKey: ["deepfake-scan", selectedScanId],
    queryFn: () => selectedScanId ? getFn({ data: { scan_id: selectedScanId } }) : null,
    enabled: !!selectedScanId,
    refetchInterval: (q) => {
      const d = q.state.data as { scan?: { status?: string } } | null | undefined;
      return d?.scan?.status === "running" ? 3_000 : false;
    },
  });

  const run = useMutation({
    mutationFn: (input: { target_name: string; aliases: string[]; handles: string[] }) =>
      runFn({ data: input }),
    onSuccess: (res) => {
      toast.success(`Scan complete — ${res.total_results} public results classified`);
      setSelectedScanId(res.scan_id);
      qc.invalidateQueries({ queryKey: ["deepfake-scans"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const upd = useMutation({
    mutationFn: (v: { finding_id: string; review_status: "new" | "reviewed" | "dismissed" | "queued_takedown" }) =>
      updFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deepfake-scan", selectedScanId] });
    },
  });

  const onRun = () => {
    const name = targetName.trim();
    if (!name) { toast.error("Enter a target name"); return; }
    const aliases = aliasesText.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
    const handles = handlesText.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
    run.mutate({ target_name: name, aliases, handles });
  };

  const scan = selected.data?.scan ?? null;
  const findings = selected.data?.findings ?? [];
  const filtered = riskFilter === "ALL" ? findings : findings.filter((f) => f.risk_level === riskFilter);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">SYNTHETIC MEDIA INTEL</div>
          <h1 className="text-2xl font-display font-semibold flex items-center gap-2">
            <ScanFace className="size-5 text-primary" />
            Deepfake &amp; Synthetic Media Intelligence
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl mt-1">
            Sweeps the public web for deepfake claims, AI-generated intimate imagery, face swaps,
            fake leaks, and non-consensual synthetic media targeting protected identities. Results
            are triaged with a cautious classifier and never asserted as fact.
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Left: control panel */}
        <div className="space-y-4">
          <div className="card-surface p-4 space-y-3">
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">NEW SCAN</div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Target name</label>
              <Input
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="Full name, brand, or protected identity"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Aliases / nicknames / prior names</label>
              <Textarea
                value={aliasesText}
                onChange={(e) => setAliasesText(e.target.value)}
                placeholder="One per line or comma-separated"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Social handles / usernames</label>
              <Textarea
                value={handlesText}
                onChange={(e) => setHandlesText(e.target.value)}
                placeholder="@handle, username, etc."
                rows={3}
              />
            </div>
            <Button className="w-full" onClick={onRun} disabled={run.isPending}>
              {run.isPending ? <><Loader2 className="size-4 mr-2 animate-spin" /> Scanning…</> : <><Radar className="size-4 mr-2" /> Run Intelligence Sweep</>}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Reddit is excluded. Site-scoped queries cover X, Twitter, Instagram, TikTok,
              YouTube, Vimeo, Facebook, Threads, Imgur, Medium, and GitHub.
            </p>
          </div>

          <div className="card-surface p-4">
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">SCAN HISTORY</div>
            {scans.isLoading ? (
              <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>
            ) : (scans.data ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">No scans yet.</div>
            ) : (
              <ul className="space-y-1.5 max-h-[420px] overflow-auto">
                {(scans.data ?? []).map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedScanId(s.id)}
                      className={`w-full text-left rounded-lg border p-2.5 transition ${
                        selectedScanId === s.id
                          ? "border-primary/60 bg-primary/5"
                          : "border-border/60 hover:bg-secondary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium truncate">{s.target_name}</div>
                        <StatusBadge status={s.status} />
                      </div>
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        <RiskChip level="CRITICAL" count={s.critical_count} />
                        <RiskChip level="HIGH" count={s.high_count} />
                        <RiskChip level="MEDIUM" count={s.medium_count} />
                        <RiskChip level="LOW" count={s.low_count} />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {new Date(s.created_at).toLocaleString()}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: findings */}
        <div className="space-y-4">
          {!scan ? (
            <div className="card-surface p-10 text-center text-sm text-muted-foreground">
              <ShieldAlert className="size-8 mx-auto mb-2 text-muted-foreground/60" strokeWidth={1.2} />
              Run a sweep or select a scan from history to view findings.
            </div>
          ) : (
            <>
              <div className="card-surface p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">TARGET</div>
                    <div className="text-lg font-semibold">{scan.target_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {scan.total_queries} queries · {scan.total_results} classified results
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={scan.status} />
                    <div className="flex items-center gap-1.5">
                      <Filter className="size-3.5 text-muted-foreground" />
                      {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setRiskFilter(r)}
                          className={`text-[10px] px-2 py-1 rounded border ${
                            riskFilter === r ? "bg-primary/15 border-primary/50 text-primary" : "border-border/60 text-muted-foreground hover:bg-secondary/40"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {scan.error_message && (
                  <div className="mt-3 text-xs text-red-500 flex items-start gap-2">
                    <AlertTriangle className="size-3.5 mt-0.5" /> {scan.error_message}
                  </div>
                )}
              </div>

              {selected.isLoading ? (
                <div className="card-surface p-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-5 mx-auto animate-spin mb-2" /> Loading findings…
                </div>
              ) : filtered.length === 0 ? (
                <div className="card-surface p-10 text-center text-sm text-muted-foreground">
                  {scan.status === "running"
                    ? "Sweep in progress — results appear as classification completes."
                    : "No findings at this risk level."}
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {filtered.map((f) => (
                    <li key={f.id}>
                      <FindingCard
                        f={f}
                        onUpdate={(status) => upd.mutate({ finding_id: f.id, review_status: status })}
                        pending={upd.isPending}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running:   "bg-blue-500/15 text-blue-400 border-blue-500/40",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    failed:    "bg-red-500/15 text-red-400 border-red-500/40",
  };
  const cls = map[status] ?? "bg-secondary text-muted-foreground border-border/60";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

function RiskChip({ level, count }: { level: RiskLevel; count: number }) {
  if (count <= 0) return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${RISK_STYLE[level].badge}`}>
      {level[0]}·{count}
    </span>
  );
}

function FindingCard({
  f,
  onUpdate,
  pending,
}: {
  f: {
    id: string; url: string; source_host: string | null; page_title: string | null;
    snippet: string | null; query: string | null; risk_level: string; content_category: string | null;
    confidence: number; is_synthetic: boolean; face_referenced: boolean; takedown_recommended: boolean;
    ai_reasoning: string | null; review_status: string;
  };
  onUpdate: (s: "reviewed" | "dismissed" | "queued_takedown") => void;
  pending: boolean;
}) {
  const risk = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).includes(f.risk_level as RiskLevel)
    ? (f.risk_level as RiskLevel) : "LOW";
  const style = RISK_STYLE[risk];
  return (
    <div className="card-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${style.badge}`}>{risk}</span>
            {f.content_category && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {f.content_category.replace(/_/g, " ")}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">· conf {f.confidence}%</span>
            {f.is_synthetic && <Badge variant="outline" className="text-[10px] py-0">synthetic</Badge>}
            {f.face_referenced && <Badge variant="outline" className="text-[10px] py-0">face ref</Badge>}
            {f.takedown_recommended && <Badge className="text-[10px] py-0 bg-red-600/20 text-red-400 border border-red-600/40">takedown</Badge>}
          </div>
          <a href={f.url} target="_blank" rel="noreferrer noopener"
             className="mt-1.5 block text-sm font-medium text-foreground hover:text-primary truncate">
            {f.page_title || f.url}
          </a>
          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
            <ExternalLink className="size-3" /> {f.source_host ?? f.url}
            {f.query && <span className="ml-1">· query “{f.query}”</span>}
          </div>
          {f.snippet && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{f.snippet}</p>}
          {f.ai_reasoning && (
            <p className="text-[11px] text-muted-foreground/90 italic mt-1.5 line-clamp-2">
              {f.ai_reasoning}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <StatusBadge status={f.review_status} />
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                    disabled={pending} onClick={() => onUpdate("reviewed")}>
              <CheckCircle2 className="size-3 mr-1" /> Review
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                    disabled={pending} onClick={() => onUpdate("dismissed")}>
              <XCircle className="size-3 mr-1" /> Dismiss
            </Button>
          </div>
          <Button size="sm" className="h-7 px-2 text-[11px]"
                  disabled={pending} onClick={() => onUpdate("queued_takedown")}>
            Queue takedown
          </Button>
        </div>
      </div>
    </div>
  );
}
