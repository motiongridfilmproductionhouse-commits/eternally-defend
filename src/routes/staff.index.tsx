import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  advanceScan,
  beginClientEnrollment,
  getDiscoveryReadiness,
  getFindingEvidence,
  getProspectScan,
  getStaffAccess,
  listProspectScans,
  recordFindingDecision,
  recordIdentityDecision,
  rescanProspect,
  startProspectScan,
  type StartScanPayload,
} from "@/lib/prospect/scan.functions";
import { StaffBoot } from "@/components/staff/StaffBoot";
import { StaffSearch, type RecentScan } from "@/components/staff/StaffSearch";
import { ScanModal } from "@/components/staff/ScanModal";
import { EvidenceDrawer, type DecisionAction } from "@/components/staff/EvidenceDrawer";
import { EnrollmentDialog, type EnrollmentResult } from "@/components/staff/EnrollmentDialog";
import { isFinished } from "@/components/staff/staff-model";

const LOGO = "/eterna-icon-512.png";
const BOOT_KEY = "eterna-staff-booted";

export const Route = createFileRoute("/staff/")({
  validateSearch: (search: Record<string, unknown>): { scan?: string } => ({
    scan: typeof search.scan === "string" ? search.scan : undefined,
  }),
  component: StaffHome,
});

function alreadyBooted(): boolean {
  try {
    return window.sessionStorage.getItem(BOOT_KEY) === "1";
  } catch {
    return false;
  }
}

function StaffHome() {
  const { scan: scanId } = Route.useSearch();
  const navigate = useNavigate({ from: "/staff/" });
  const qc = useQueryClient();
  const [booted, setBooted] = useState(alreadyBooted);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollResult, setEnrollResult] = useState<EnrollmentResult | null>(null);

  const accessFn = useServerFn(getStaffAccess);
  const readinessFn = useServerFn(getDiscoveryReadiness);
  const listFn = useServerFn(listProspectScans);
  const startFn = useServerFn(startProspectScan);
  const scanFn = useServerFn(getProspectScan);
  const evidenceFn = useServerFn(getFindingEvidence);
  const decisionFn = useServerFn(recordFindingDecision);
  const identityFn = useServerFn(recordIdentityDecision);
  const rescanFn = useServerFn(rescanProspect);
  const enrollFn = useServerFn(beginClientEnrollment);
  const advanceFn = useServerFn(advanceScan);

  const readiness = useQuery({
    queryKey: ["staff-readiness"],
    queryFn: () => readinessFn(),
    enabled: booted,
    staleTime: 60_000,
  });
  const recent = useQuery({
    queryKey: ["staff-recent"],
    queryFn: () => listFn(),
    enabled: booted && !scanId,
  });

  const scan = useQuery({
    queryKey: ["prospect-scan", scanId],
    queryFn: () => scanFn({ data: { scanId: scanId! } }),
    enabled: Boolean(scanId),
    refetchInterval: (q) => (q.state.data && isFinished(q.state.data.scan.status) ? false : 1500),
  });

  // Realtime nudge: refetch the stored snapshot as soon as the backend appends an event.
  useEffect(() => {
    if (!scanId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`prospect-scan-${scanId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "prospect_scan_events",
            filter: `scan_id=eq.${scanId}`,
          },
          () => void qc.invalidateQueries({ queryKey: ["prospect-scan", scanId] }),
        )
        .subscribe();
    } catch {
      channel = null; // polling remains the fallback
    }
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [scanId, qc]);

  // Scans run on the server (worker hook + pg_cron); closing, refreshing or
  // reconnecting never affects them. While the popup is open it only acts as a
  // watchdog: if no new stored event has appeared for a while, it asks the
  // server to run one lease-protected step (a no-op when a worker holds it).
  const scanFinished = scan.data ? isFinished(scan.data.scan.status) : false;
  const lastEventAt = (() => {
    const events = scan.data?.events ?? [];
    const last = events[events.length - 1];
    return last ? Date.parse(last.created_at) : null;
  })();
  const [driveError, setDriveError] = useState<string | null>(null);
  useEffect(() => {
    if (!scanId || scanFinished) return;
    let cancelled = false;
    let busy = false;
    const STALL_MS = 45_000;
    const tick = async () => {
      if (cancelled || busy) return;
      const quietFor = lastEventAt == null ? Infinity : Date.now() - lastEventAt;
      if (quietFor < STALL_MS) return;
      busy = true;
      try {
        await advanceFn({ data: { scanId } });
        setDriveError(null);
        void qc.invalidateQueries({ queryKey: ["prospect-scan", scanId] });
      } catch (e) {
        setDriveError(e instanceof Error ? e.message : "Scan step failed");
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [scanId, scanFinished, lastEventAt, advanceFn, qc]);

  const evidence = useQuery({
    queryKey: ["prospect-evidence", findingId],
    queryFn: () => evidenceFn({ data: { findingId: findingId! } }),
    enabled: Boolean(findingId),
  });

  const refreshScan = () => {
    void qc.invalidateQueries({ queryKey: ["prospect-scan", scanId] });
    void qc.invalidateQueries({ queryKey: ["prospect-evidence", findingId] });
  };

  const start = useMutation({
    mutationFn: (payload: StartScanPayload) => startFn({ data: payload }),
    onSuccess: (res) => navigate({ search: { scan: res.scanId } }),
  });
  const rescan = useMutation({
    mutationFn: () => rescanFn({ data: { scanId: scanId! } }),
    onSuccess: (res) => navigate({ search: { scan: res.scanId } }),
  });
  const decide = useMutation({
    mutationFn: (v: { action: DecisionAction; reason: string; reclassifyAs?: string }) =>
      decisionFn({
        data: {
          findingId: findingId!,
          action: v.action,
          reason: v.reason || undefined,
          reclassifyAs: v.reclassifyAs,
        },
      }),
    onSuccess: refreshScan,
  });
  const identity = useMutation({
    mutationFn: (v: { discoveryId: string; decision: "MATCHED" | "UNRELATED"; reason?: string }) =>
      identityFn({
        data: { discoveryId: v.discoveryId, decision: v.decision, reason: v.reason || undefined },
      }),
    onSuccess: refreshScan,
  });
  const enroll = useMutation({
    mutationFn: (v: { findingIds: string[]; clientEmail: string }) =>
      enrollFn({
        data: { scanId: scanId!, findingIds: v.findingIds, clientEmail: v.clientEmail || null },
      }),
    onSuccess: (res) => setEnrollResult(res),
  });

  const finishBoot = () => {
    try {
      window.sessionStorage.setItem(BOOT_KEY, "1");
    } catch {
      /* private mode: boot shows again next time */
    }
    setBooted(true);
  };

  if (!booted) {
    return (
      <StaffBoot
        logoSrc={LOGO}
        onDone={finishBoot}
        checks={[
          async () => {
            const { data } = await supabase.auth.getSession();
            if (!data.session) throw new Error("No session");
          },
          async () => {
            const res = await accessFn();
            if (!res.isStaff) throw new Error("Staff role required");
          },
          async () => {
            const res = await qc.fetchQuery({
              queryKey: ["staff-readiness"],
              queryFn: () => readinessFn(),
            });
            if (!res.families.length) throw new Error("No source registry");
          },
        ]}
      />
    );
  }

  const snap = scan.data;

  return (
    <>
      <div className="sx-ambient" aria-hidden="true" />
      <div className="sx-grid-bg" aria-hidden="true" />
      <div className="sx-shell">
        <header className="sx-topbar">
          <div className="sx-brand">
            <span className="sx-brand-mark">
              <img src={LOGO} alt="" />
            </span>
            <span className="sx-brand-name">ETERNA</span>
            <span className="sx-chip c-violet">Staff · Identity Intelligence</span>
          </div>
          <button
            type="button"
            className="sx-btn ghost sm"
            onClick={async () => {
              await supabase.auth.signOut();
              try {
                window.sessionStorage.removeItem(BOOT_KEY);
              } catch {
                /* ignore */
              }
              window.location.href = "/auth";
            }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </header>
        <StaffSearch
          readiness={readiness.data?.families ?? null}
          detector={readiness.data?.detector}
          recent={(recent.data?.scans ?? []) as unknown as RecentScan[]}
          starting={start.isPending}
          error={start.error ? (start.error as Error).message : null}
          onStart={(payload) => start.mutate(payload)}
          onOpenScan={(id) => navigate({ search: { scan: id } })}
        />
      </div>

      {scanId && snap ? (
        <ScanModal
          snap={snap}
          logoSrc={LOGO}
          busy={decide.isPending || identity.isPending || rescan.isPending}
          onClose={() => {
            setFindingId(null);
            navigate({ search: {} });
          }}
          onOpenFinding={(id) => setFindingId(id)}
          onIdentityDecision={(discoveryId, decision) => identity.mutate({ discoveryId, decision })}
          onRescan={() => rescan.mutate()}
          onEnroll={() => {
            setEnrollResult(null);
            setEnrollOpen(true);
          }}
          onReport={() => window.open(`/staff/report/${scanId}`, "_blank", "noopener")}
        />
      ) : null}
      {scanId && driveError && !scanFinished ? (
        <div
          className="sx-note warn"
          role="status"
          style={{
            position: "fixed",
            zIndex: 80,
            left: "50%",
            bottom: 90,
            transform: "translateX(-50%)",
          }}
        >
          Scan worker: {driveError} — the server will keep retrying.
        </div>
      ) : null}
      {scanId && scan.isError ? (
        <div className="sx-scrim" style={{ display: "grid", placeItems: "center" }}>
          <div className="sx-note warn" role="alert">
            Could not load this scan: {(scan.error as Error).message}
            <button type="button" className="sx-btn sm" onClick={() => navigate({ search: {} })}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {findingId ? (
        <EvidenceDrawer
          data={evidence.data ?? null}
          loading={evidence.isLoading}
          busy={decide.isPending || identity.isPending}
          onClose={() => setFindingId(null)}
          onDecision={(action, reason, reclassifyAs) =>
            decide.mutate({ action, reason, reclassifyAs })
          }
          onIdentity={(decision, reason) => {
            const discoveryId = evidence.data?.finding.discovery_id;
            if (typeof discoveryId === "string") identity.mutate({ discoveryId, decision, reason });
          }}
        />
      ) : null}

      {enrollOpen && snap ? (
        <EnrollmentDialog
          snap={snap}
          busy={enroll.isPending}
          result={enrollResult}
          error={enroll.error ? (enroll.error as Error).message : null}
          onClose={() => setEnrollOpen(false)}
          onSubmit={(findingIds, clientEmail) => enroll.mutate({ findingIds, clientEmail })}
        />
      ) : null}
    </>
  );
}
