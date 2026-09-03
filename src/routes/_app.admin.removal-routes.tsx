import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminGuard } from "@/components/AdminGuard";
import { PageCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listRemovalRoutes,
  previewRemovalRoute,
  reprocessDiscoveredRoutes,
  setRemovalRouteStatus,
  verifyRemovalRoute,
  type RemovalRouteView,
} from "@/lib/enforcement/removal-routes.functions";
import {
  triageAndSortRoutes,
  type TriagedRoute,
  type TriagePriority,
} from "@/lib/enforcement/route-triage";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";


export const Route = createFileRoute("/_app/admin/removal-routes")({
  head: () => ({
    meta: [
      { title: "Removal Routes — Eterna Sentinel Admin" },
      {
        name: "description",
        content:
          "Operator review of authoritative removal recipient routes: discovered, unverified, verified, stale and rejected.",
      },
      { property: "og:title", content: "Removal Routes — Eterna Sentinel Admin" },
      {
        property: "og:description",
        content: "Evidence-gated verification of DMCA removal recipient routes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminGuard>
      <RemovalRoutesPage />
    </AdminGuard>
  ),
});

/**
 * Email-eligible verification methods only. Hosting-provider and registrar
 * abuse channels are deliberately absent: they route to manual escalation and
 * can never be promoted to an automated email recipient.
 */
const METHODS = ["PUBLISHED_DMCA_PAGE", "PUBLISHED_LEGAL_CONTACT", "OFFICIAL_CORRESPONDENCE"];

function statusTone(status: string) {
  if (status === "VERIFIED") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (status === "STALE") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (status === "REJECTED") return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  return "bg-slate-500/15 text-slate-300 border-slate-500/30";
}

function triageTone(priority: TriagePriority) {
  if (priority === "HIGH") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
  if (priority === "MEDIUM") return "bg-amber-500/15 text-amber-300 border-amber-500/40";
  return "bg-slate-500/15 text-slate-400 border-slate-500/30";
}

/** Presentation-only row. Actions still run through the existing server gates. */
function RouteRow({
  item,
  onInspect,
}: {
  item: TriagedRoute;
  onInspect: (r: RemovalRouteView) => void;
}) {
  const r = item.route;
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium truncate">{r.domain}</span>
          <Badge variant="outline" className={triageTone(item.triage.priority)}>
            {item.triage.label}
          </Badge>
          <Badge variant="outline" className={statusTone(r.effectiveStatus)}>
            {r.effectiveStatus}
          </Badge>
          <Badge variant="outline">{r.routeType}</Badge>
          {r.autoDiscovered && (
            <Badge variant="outline" className="bg-sky-500/10 text-sky-400 border-sky-500/30">
              auto-discovered
            </Badge>
          )}
          {r.isGuessedCandidate && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
              <AlertTriangle className="size-3 mr-1" /> guessed
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {r.recipientEmail ?? "no recipient"} · {r.verificationMethod ?? "no method"}
          {r.discoveredAt ? ` · found ${r.discoveredAt.slice(0, 16).replace("T", " ")}` : ""}
          {r.reverifyDueAt ? ` · re-verify ${r.reverifyDueAt.slice(0, 10)}` : ""}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">
          {r.authoritativePageKind
            ? `${r.authoritativePageKind} page evidence`
            : "no authoritative page evidence"}
          {r.evidenceUrl ? ` · ${r.evidenceUrl}` : ""} · confidence {r.confidence.toFixed(2)}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {item.triage.reasons.join(" · ")}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={() => onInspect(r)}>
        Inspect
      </Button>
    </li>
  );
}


function RemovalRoutesPage() {
  const fetchRoutes = useServerFn(listRemovalRoutes);
  const verify = useServerFn(verifyRemovalRoute);
  const setStatus = useServerFn(setRemovalRouteStatus);
  const preview = useServerFn(previewRemovalRoute);
  const reprocess = useServerFn(reprocessDiscoveredRoutes);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin_removal_routes"],
    queryFn: () => fetchRoutes(),
  });

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RemovalRouteView | null>(null);
  const [busy, setBusy] = useState(false);

  const [recipient, setRecipient] = useState("");
  const [method, setMethod] = useState(METHODS[0]!);
  const [sourceUrl, setSourceUrl] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [note, setNote] = useState("");

  const [probeUrl, setProbeUrl] = useState("");
  const [probeResult, setProbeResult] = useState<string | null>(null);

  const routes = data?.routes ?? [];
  const filtered = useMemo(
    () =>
      routes.filter((r) =>
        search.trim()
          ? `${r.domain} ${r.recipientEmail ?? ""}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())
          : true,
      ),
    [routes, search],
  );

  const [showLow, setShowLow] = useState(false);
  const triaged = useMemo(() => triageAndSortRoutes(filtered), [filtered]);
  const highRows = triaged.filter((t) => t.triage.priority === "HIGH");
  const mediumRows = triaged.filter((t) => t.triage.priority === "MEDIUM");
  const lowRows = triaged.filter((t) => t.triage.priority === "LOW");



  function openRoute(r: RemovalRouteView) {
    setSelected(r);
    setRecipient(r.recipientEmail ?? "");
    const candidate = r.verificationMethodCandidate ?? r.verificationMethod;
    setMethod(candidate && METHODS.includes(candidate) ? candidate : METHODS[0]!);
    setSourceUrl(r.evidenceUrl ?? r.authoritativeSourceUrl ?? "");
    setExcerpt(String(r.evidenceSnapshot?.excerpt ?? ""));
    setNote(String(r.evidenceSnapshot?.operator_note ?? ""));
  }

  async function onVerify() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await verify({
        data: {
          domain: selected.domain,
          recipientEmail: recipient,
          routeType: "EMAIL_DMCA",
          verificationMethod: method,
          authoritativeSourceUrl: sourceUrl,
          evidenceExcerpt: excerpt || undefined,
          operatorNote: note || undefined,
        },
      });
      if (res.ok) {
        toast.success(
          `${selected.domain} verified — email route now eligible (live sending still disabled).`,
        );
        setSelected(null);
        refetch();
      } else {
        toast.error(res.issues?.join(" ") ?? "Verification refused.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSetStatus(status: "REJECTED" | "STALE" | "MANUAL_REVIEW") {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await setStatus({
        data: { domain: selected.domain, status, reason: note || undefined },
      });
      if (res.ok) {
        toast.success(`${selected.domain} marked ${status}.`);
        setSelected(null);
        refetch();
      } else {
        toast.error(res.issues?.join(" ") ?? "Not permitted.");
      }
    } finally {
      setBusy(false);
    }
  }

  const [reprocessing, setReprocessing] = useState(false);
  async function onReprocess() {
    setReprocessing(true);
    try {
      const res = await reprocess({ data: { limit: 25, dryRun: true } });
      if (!res.ok) {
        toast.error(res.issues?.join(" ") ?? "Not permitted.");
        return;
      }
      toast.success(
        `Evidence dry run: ${res.upgraded}/${res.examined} domains publish an authoritative contact. Nothing was written and no route was promoted.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reprocess failed");
    } finally {
      setReprocessing(false);
    }
  }

  async function onProbe() {
    if (!probeUrl.trim()) return;
    try {
      const res = await preview({ data: { targetUrl: probeUrl.trim() } });
      setProbeResult(`${res.platformLabel} → ${res.routeType} — ${res.reason}`);
    } catch (e) {
      setProbeResult(e instanceof Error ? e.message : "Classification failed");
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Removal Routes</h1>
          <p className="text-xs text-muted-foreground">
            A recipient becomes auto-sendable only with authoritative evidence. Guessed mailboxes
            stay unverified. Live sending remains disabled.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onReprocess} disabled={reprocessing}>
            {reprocessing ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Search className="size-4 mr-2" />
            )}
            Re-check evidence (dry run)
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className="size-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <PageCard title="Route classifier" sub="Check how a target URL would be routed — read-only.">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="https://example.com/page"
            value={probeUrl}
            onChange={(e) => setProbeUrl(e.target.value)}
            className="max-w-md"
          />
          <Button variant="secondary" size="sm" onClick={onProbe}>
            <Search className="size-4 mr-2" /> Classify
          </Button>
        </div>
        {probeResult && <p className="mt-3 text-xs text-muted-foreground">{probeResult}</p>}
      </PageCard>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by domain or recipient"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="space-y-4">
        <PageCard
          title={`Ready for removal review (${highRows.length})`}
          sub="Operator-verified routes with a same-organisation recipient that already satisfy the existing verification gates. Live sending stays disabled — review only."
        >
          {highRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No route currently satisfies every existing gate.
            </p>
          ) : (
            <ul className="space-y-2">
              {highRows.map((t) => (
                <RouteRow key={t.route.id} item={t} onInspect={openRoute} />
              ))}
            </ul>
          )}
        </PageCard>

        <PageCard
          title={`Needs verification (${mediumRows.length})`}
          sub="Authoritative page evidence captured, but nothing is actionable until an operator verifies the route."
        >
          {mediumRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No candidate evidence awaiting review.</p>
          ) : (
            <ul className="space-y-2">
              {mediumRows.map((t) => (
                <RouteRow key={t.route.id} item={t} onInspect={openRoute} />
              ))}
            </ul>
          )}
        </PageCard>

        <PageCard title={`Other / Not currently actionable (${lowRows.length})`}>
          <button
            type="button"
            onClick={() => setShowLow((v) => !v)}
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {showLow ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {showLow ? "Hide" : "Show"} generic mailboxes, unproven pages, blocked hosts, rejected
            and stale routes
          </button>
          {showLow && (
            <ul className="mt-3 space-y-2">
              {lowRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing in this bucket.</p>
              ) : (
                lowRows.map((t) => (
                  <RouteRow key={t.route.id} item={t} onInspect={openRoute} />
                ))
              )}
            </ul>
          )}
        </PageCard>
      </div>


      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected?.domain}</DialogTitle>
            <DialogDescription>
              Verification requires an authoritative source (published DMCA/legal/abuse page) plus
              evidence. Guessed mailboxes can never be promoted automatically.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border/60 p-3 text-xs space-y-1">
                <p>
                  Current state: <span className="font-medium">{selected.effectiveStatus}</span> ·{" "}
                  {selected.routeType}
                </p>
                <p>Discovered via: {selected.verificationMethod ?? "—"}</p>
                <p>
                  Authoritative page: {selected.authoritativePageKind ?? "none proven"} · method
                  candidate: {selected.verificationMethodCandidate ?? "—"} · confidence{" "}
                  {selected.confidence.toFixed(2)}
                </p>
                {selected.evidenceUrl && (
                  <p className="truncate">Evidence page: {selected.evidenceUrl}</p>
                )}
                {(selected.evidenceSnapshot?.authority_signals?.length ?? 0) > 0 && (
                  <p className="text-muted-foreground">
                    Authority signals: {selected.evidenceSnapshot.authority_signals!.join(" ")}
                  </p>
                )}
                {selected.discoveredAt && (
                  <p>Discovery timestamp: {selected.discoveredAt.slice(0, 19).replace("T", " ")}</p>
                )}
                {(selected.discoveryFindingId || selected.discoveryCaseId) && (
                  <p>
                    Association: finding {selected.discoveryFindingId ?? "—"} · case{" "}
                    {selected.discoveryCaseId ?? "—"}
                    {selected.discoverySourceType ? ` · ${selected.discoverySourceType}` : ""}
                  </p>
                )}
                {selected.discoveryFindingUrl && (
                  <p className="truncate">Finding URL: {selected.discoveryFindingUrl}</p>
                )}
                <p>Last checked: {selected.lastCheckedAt?.slice(0, 19).replace("T", " ") ?? "—"}</p>
                {selected.authoritativeSourceUrl && (
                  <a
                    href={selected.authoritativeSourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-primary"
                  >
                    <ExternalLink className="size-3" /> current source
                  </a>
                )}
                {selected.evidenceSnapshot?.html_hash && (
                  <p>Captured page hash: {selected.evidenceSnapshot.html_hash}</p>
                )}
                {(selected.evidenceSnapshot?.pages_inspected?.length ?? 0) > 0 && (
                  <p className="truncate">
                    Pages inspected: {selected.evidenceSnapshot.pages_inspected!.join(", ")}
                  </p>
                )}
                {selected.evidenceSnapshot?.excerpt && (
                  <p className="text-muted-foreground">
                    Captured evidence: “{String(selected.evidenceSnapshot.excerpt).slice(0, 300)}”
                  </p>
                )}

                {selected.rejectedReason && (
                  <p className="text-rose-400">Rejected: {selected.rejectedReason}</p>
                )}
              </div>

              <div className="space-y-2">
                <Input
                  placeholder="Recipient address from the authoritative page"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder="Authoritative source URL (https://…/dmca)"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
                <Textarea
                  placeholder="Evidence excerpt copied from that page"
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  rows={3}
                />
                <Textarea
                  placeholder="Operator note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={onVerify} disabled={busy}>
                  {busy ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4 mr-2" />
                  )}
                  VERIFY ROUTE
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSetStatus("MANUAL_REVIEW")}
                  disabled={busy}
                >
                  <CheckCircle2 className="size-4 mr-2" /> Needs review
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSetStatus("STALE")}
                  disabled={busy}
                >
                  Mark stale
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onSetStatus("REJECTED")}
                  disabled={busy}
                >
                  <XCircle className="size-4 mr-2" /> Reject
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
