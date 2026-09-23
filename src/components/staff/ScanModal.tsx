import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileText,
  Info,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import type { ScanSnapshotView } from "@/lib/prospect/snapshot.server";
import { coverageWord, zeroFindingsLabel } from "@/lib/prospect/coverage";
import {
  FINDING_STATE_LABEL,
  IDENTITY_LABEL,
  RAIL,
  bandLabel,
  fmtDate,
  fmtTime,
  hostOf,
  identityTone,
  isFinished,
  joinFindings,
  railStates,
  followStage,
  sourceStatusText,
  sourceTypeOf,
  stateTone,
  type JoinedFinding,
  type RailKey,
} from "./staff-model";

type Snap = ScanSnapshotView;

export interface ScanModalProps {
  snap: Snap;
  logoSrc: string;
  onClose: () => void;
  onOpenFinding: (findingId: string) => void;
  onIdentityDecision: (discoveryId: string, decision: "MATCHED" | "UNRELATED") => void;
  onRescan: () => void;
  onEnroll: () => void;
  onReport: () => void;
  busy?: boolean;
}

export function ScanModal(props: ScanModalProps) {
  const { snap } = props;
  const finished = isFinished(snap.scan.status);
  const states = railStates(snap);
  const [manual, setManual] = useState<RailKey | "review" | null>(null);
  const view: RailKey | "review" = manual ?? followStage(snap);
  const name = String(snap.identity?.display_name ?? "");
  const c = snap.analysis.counts;
  const lastEvent = snap.events[snap.events.length - 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <>
      <div className="sx-scrim" />
      <section
        className="sx-modal"
        role="dialog"
        aria-modal="true"
        aria-label={finished ? "Digital Exposure Intelligence" : "Live intelligence scan"}
      >
        <header className="sx-mh">
          <IntelligenceCore logoSrc={props.logoSrc} running={!finished} />
          <div style={{ minWidth: 0 }}>
            <div className="sx-eyebrow" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>
                {finished ? "Digital Exposure Intelligence" : "Scanning Digital Exposure"}
              </span>
              <span className="sx-chip c-violet" style={{ height: 20 }}>
                Pre-enrollment · prospect intelligence
              </span>
            </div>
            <h2 className="sx-display" title={name}>
              {name}
            </h2>
            <div className="live-line" aria-live="polite">
              <span className={`sx-eq${finished ? " is-idle" : ""}`} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {snap.scan.status === "failed"
                  ? `Scan failed · ${String(snap.scan.error_message ?? "")}`
                  : finished
                    ? `Scan complete · ${fmtTime(String(snap.scan.finished_at ?? ""))}`
                    : snap.scan.status === "queued"
                      ? "Waiting for the scan worker to start…"
                      : (lastEvent?.message ?? "Connecting…")}
              </span>
            </div>
          </div>
          <div className="sx-mh-right">
            <button
              type="button"
              className="sx-iconbtn"
              onClick={props.onClose}
              aria-label="Close scan"
            >
              <X size={17} />
            </button>
            <CoverageChip snap={snap} />
          </div>
        </header>

        <div className="sx-sources" aria-label="Source status">
          {snap.sources.length === 0 ? (
            <span className="sx-src" data-state="connecting">
              <span className="d" />
              Preparing source families
            </span>
          ) : (
            snap.sources.map((s) => (
              <span
                key={s.family_key}
                className="sx-src"
                data-state={s.state}
                title={[s.failure_reason, (s.providers ?? []).join(" · ")]
                  .filter(Boolean)
                  .join("\n")}
              >
                <span className="d" />
                {s.family_label}
                <span className="st">{sourceStatusText(s)}</span>
              </span>
            ))
          )}
        </div>

        <div className="sx-mb">
          <nav className="sx-rail" aria-label="Analysis stages">
            {RAIL.map((r) => {
              const st = states[r.key];
              const count = r.key === "summary" ? null : snap.analysis.stages[r.key]?.relevant;
              return (
                <button
                  key={r.key}
                  type="button"
                  className="sx-rail-item"
                  data-state={st}
                  aria-current={view === r.key}
                  onClick={() => setManual(r.key === followStage(snap) && !finished ? null : r.key)}
                >
                  <span className="sx-ind">
                    {st === "done" ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M5 12.5l4.5 4.5L19 7.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      r.n
                    )}
                  </span>
                  <span>
                    <span className="sx-rail-t" style={{ display: "block" }}>
                      {r.n} {r.label}
                    </span>
                    <span className="sx-rail-s" style={{ display: "block" }}>
                      {st === "done"
                        ? r.key === "summary"
                          ? "Ready"
                          : `Complete${count ? ` · ${count}` : ""}`
                        : st === "active"
                          ? "Analysing…"
                          : st === "live"
                            ? `Classifying live${count ? ` · ${count}` : ""}`
                            : "Waiting"}
                    </span>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              className="sx-rail-item"
              data-state={c.identityReviewQueue + c.needsVerification > 0 ? "live" : "waiting"}
              aria-current={view === "review"}
              onClick={() => setManual("review")}
              style={{ marginTop: 10 }}
            >
              <span className="sx-ind">
                <UserCheck size={14} />
              </span>
              <span>
                <span className="sx-rail-t" style={{ display: "block" }}>
                  Human verification
                </span>
                <span className="sx-rail-s" style={{ display: "block" }}>
                  {c.needsVerification} awaiting · {c.identityReviewQueue} identity
                </span>
              </span>
            </button>
          </nav>

          <main className="sx-ws">
            <div className="sx-view" key={view}>
              {view === "ai_manipulation" ? (
                <DeepfakeView snap={snap} onOpen={props.onOpenFinding} />
              ) : null}
              {view === "harmful_content" ? (
                <ReputationView snap={snap} onOpen={props.onOpenFinding} />
              ) : null}
              {view === "impersonation" ? (
                <ImpersonationView snap={snap} onOpen={props.onOpenFinding} />
              ) : null}
              {view === "privacy_exposure" ? (
                <PrivacyView snap={snap} onOpen={props.onOpenFinding} />
              ) : null}
              {view === "search_reputation" ? (
                <SearchView snap={snap} onOpen={props.onOpenFinding} />
              ) : null}
              {view === "propagation" ? (
                <PropagationView snap={snap} onOpen={props.onOpenFinding} />
              ) : null}
              {view === "summary" ? <SummaryView snap={snap} onJump={(k) => setManual(k)} /> : null}
              {view === "review" ? (
                <ReviewView
                  snap={snap}
                  onOpen={props.onOpenFinding}
                  onIdentity={props.onIdentityDecision}
                  busy={props.busy}
                />
              ) : null}
            </div>
          </main>

          <aside className="sx-stream" aria-label="Live discovery stream">
            <div className="sx-stream-h">
              <span className="sx-eyebrow">Live discovery stream</span>
              <span className="sx-mono" style={{ fontSize: 10.5, color: "var(--sx-faint)" }}>
                {snap.events.length ? `${snap.events.length} recent` : ""}
              </span>
            </div>
            <div className="sx-stream-list">
              {snap.events.length === 0 ? (
                <div className="sx-ev">
                  <span className="d" />
                  <span>No backend events yet.</span>
                </div>
              ) : (
                [...snap.events]
                  .filter((e) => e.level !== "debug")
                  .reverse()
                  .slice(0, 80)
                  .map((e) => (
                    <div key={e.id} className="sx-ev" data-level={e.level}>
                      <span className="d" />
                      <span>
                        {e.message}
                        <div className="t">
                          {fmtTime(e.created_at)} ·{" "}
                          {String(e.detail?.type ?? "")
                            .replace(/_/g, " ")
                            .toLowerCase()}
                        </div>
                      </span>
                    </div>
                  ))
              )}
            </div>
          </aside>
        </div>

        <footer className="sx-mf">
          <Counter label="Sources discovered" value={c.sourcesDiscovered} />
          <Counter label="Relevant items (identity-matched)" value={c.relevantItems} />
          <Counter label="Needs verification" value={c.needsVerification + c.identityReviewQueue} />
          <Counter
            label={finished ? "Verified high-priority" : "High-priority (preliminary)"}
            value={finished ? c.verifiedHighPriority : c.highPriorityPreliminary}
          />
          <div className="sx-mf-actions">
            {finished ? (
              <>
                <button type="button" className="sx-btn sm" onClick={() => setManual("review")}>
                  Review Findings
                </button>
                <button type="button" className="sx-btn sm" onClick={props.onReport}>
                  <FileText size={14} />
                  Create Pre-Enrollment Report
                </button>
                <button
                  type="button"
                  className="sx-btn sm"
                  onClick={props.onRescan}
                  disabled={props.busy}
                >
                  <RefreshCw size={14} />
                  Rescan
                </button>
                <button type="button" className="sx-btn sm primary" onClick={props.onEnroll}>
                  Begin Client Enrollment
                  <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <span className="sx-mono" style={{ fontSize: 11, color: "var(--sx-faint)" }}>
                Counters update only when records are stored
              </span>
            )}
          </div>
        </footer>
      </section>
    </>
  );
}

/* ── Header pieces ──────────────────────────────────────────────────────── */

function IntelligenceCore({ logoSrc, running }: { logoSrc: string; running: boolean }) {
  return (
    <div className={`sx-core${running ? "" : " is-idle"}`} aria-hidden="true">
      <svg viewBox="0 0 120 120">
        <defs>
          <linearGradient id="sxCoreG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4fd4ee" />
            <stop offset="1" stopColor="#9b85ff" />
          </linearGradient>
          <radialGradient id="sxCoreGlow">
            <stop offset="0" stopColor="rgba(91,140,255,0.35)" />
            <stop offset="1" stopColor="rgba(91,140,255,0)" />
          </radialGradient>
          <linearGradient id="sxSweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="rgba(79,212,238,0)" />
            <stop offset="1" stopColor="rgba(79,212,238,0.35)" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="58" fill="url(#sxCoreGlow)" />
        <circle
          className="pulse"
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="rgba(79,212,238,0.6)"
          strokeWidth="1"
        />
        <g className="sweep">
          <path d="M60 60 L60 4 A56 56 0 0 1 108 32 Z" fill="url(#sxSweep)" />
        </g>
        <g className="r1">
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke="url(#sxCoreG)"
            strokeWidth="1.2"
            strokeDasharray="70 270"
            strokeLinecap="round"
          />
          <circle cx="114" cy="60" r="2" fill="#4fd4ee" />
        </g>
        <g className="r2">
          <circle
            cx="60"
            cy="60"
            r="44"
            fill="none"
            stroke="rgba(155,133,255,0.45)"
            strokeWidth="0.8"
            strokeDasharray="2 5"
          />
        </g>
        <circle cx="60" cy="60" r="34" fill="rgba(10,14,26,0.9)" stroke="rgba(150,176,255,0.18)" />
      </svg>
      <div className="sx-core-logo">
        <img src={logoSrc} alt="" />
      </div>
    </div>
  );
}

function CoverageChip({ snap }: { snap: Snap }) {
  const cov = snap.analysis.coverage;
  const anyScanned = snap.sources.some(
    (s) => s.state === "results_found" || s.state === "no_results" || s.state === "provider_error",
  );
  if (!anyScanned) {
    return (
      <span className="sx-chip c-cyan c-live">
        <span className="d" />
        Coverage pending
      </span>
    );
  }
  const tone = cov.state === "COMPLETE" ? "c-ok" : cov.state === "PARTIAL" ? "c-warn" : "c-risk";
  return (
    <span className={`sx-chip ${tone}`} title={cov.label}>
      <span className="d" />
      Coverage {coverageWord(cov.state)} · {cov.queriedOk}/{cov.intended + cov.policyDisabled}
    </span>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (value > prev.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 900);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return (
    <div className={`sx-counter${flash ? " flash" : ""}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/* ── Shared stage pieces ────────────────────────────────────────────────── */

function StageHead({
  n,
  title,
  copy,
  status,
}: {
  n: string;
  title: string;
  copy: string;
  status: ReactNode;
}) {
  return (
    <div className="sx-stage-h">
      <div>
        <div className="sx-eyebrow">
          <span style={{ color: "var(--sx-cyan)" }}>Stage {n}</span> · real discovered data only
        </div>
        <h3 className="sx-display">{title}</h3>
        <p>{copy}</p>
      </div>
      {status}
    </div>
  );
}

function StageStatus({ snap, stage, doneText }: { snap: Snap; stage: RailKey; doneText: string }) {
  const st = railStates(snap)[stage];
  if (st === "done")
    return (
      <span className="sx-chip c-ok">
        <Check size={12} />
        {doneText}
      </span>
    );
  if (st === "active" || st === "live")
    return (
      <span className="sx-chip c-cyan c-live">
        <span className="d" />
        {st === "live" ? "Classifying as results arrive" : "Analysing"}
      </span>
    );
  return (
    <span className="sx-chip c-mute">
      <span className="d" />
      Waiting for discovery
    </span>
  );
}

function CapabilityNote({ snap, stage }: { snap: Snap; stage: string }) {
  const cap = snap.capabilities.find((x) => x.analysis_key === stage);
  if (!cap) return null;
  return (
    <div className={`sx-note ${cap.status === "ran" ? "" : "warn"}`} style={{ marginTop: 14 }}>
      <Info size={15} />
      <span>
        <b style={{ fontWeight: 600 }}>
          {cap.status === "ran" ? "Analysis ran" : "Analysis unavailable"}
        </b>{" "}
        · {cap.reason}
      </span>
    </div>
  );
}

function PendingIdentityNote({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className="sx-note info" style={{ marginBottom: 14 }}>
      <UserCheck size={15} />
      <span>
        {count} further item{count === 1 ? "" : "s"} await identity verification and are not
        included in the totals above.
      </span>
    </div>
  );
}

function FindingCard({
  f,
  onOpen,
  index,
  extra,
}: {
  f: JoinedFinding;
  onOpen: (id: string) => void;
  index: number;
  extra?: ReactNode;
}) {
  const d = f.discovery;
  const thumb = d?.thumbnail_url;
  return (
    <button
      type="button"
      className={`sx-card${thumb ? "" : " no-thumb"}`}
      onClick={() => onOpen(f.id)}
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      {thumb ? (
        <span className="sx-thumb">
          <img
            src={thumb}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        </span>
      ) : null}
      <span style={{ minWidth: 0 }}>
        <span className="sx-card-t">
          {d?.title || hostOf(d?.original_url) || "Untitled source"}
        </span>
        <span className="sx-card-u" style={{ display: "block" }}>
          {d?.original_url}
        </span>
        <span className="sx-card-x">{f.detection_reason}</span>
        <span className="sx-card-m">
          <span className={`sx-tag ${Number(f.severity) >= 7 ? "risk" : "blue"}`}>
            {f.category}
          </span>
          <span className={`sx-tag ${stateTone(f.state)}`}>
            {FINDING_STATE_LABEL[f.state] ?? f.state}
          </span>
          {d ? (
            <span
              className={`sx-tag ${identityTone(d.identity_bucket)}`}
              title={d.identity_explanation ?? ""}
            >
              {IDENTITY_LABEL[d.identity_bucket]} · {d.identity_confidence}%
            </span>
          ) : null}
          {d?.platform ? <span className="sx-tag mute">{d.platform}</span> : null}
          {d ? (
            <span className="sx-tag mute">
              {d.discovery_method === "WEB_SEARCH"
                ? "via web search"
                : d.discovery_method.replace(/_/g, " ").toLowerCase()}
            </span>
          ) : null}
          {extra}
        </span>
      </span>
    </button>
  );
}

function matchedOnly(list: JoinedFinding[]) {
  return list.filter((f) => f.discovery?.identity_bucket === "MATCHED" && f.state !== "REJECTED");
}

/* ── 01 Deepfake ────────────────────────────────────────────────────────── */

function DeepfakeView({ snap, onOpen }: { snap: Snap; onOpen: (id: string) => void }) {
  const signals = matchedOnly(joinFindings(snap, "ai_manipulation"));
  const media = snap.discoveries.filter((d) => d.media_kind && d.identity_bucket === "MATCHED");
  const cap = snap.capabilities.find((x) => x.analysis_key === "ai_manipulation");
  const stats = snap.analysis.stages.ai_manipulation;
  return (
    <>
      <StageHead
        n="01"
        title="Deepfake & AI Manipulation"
        copy="Discovered images and videos are candidates only. A manipulation signal appears here only when a configured detector actually analysed the media."
        status={
          <StageStatus snap={snap} stage="ai_manipulation" doneText="Deepfake analysis complete" />
        }
      />
      <div className="sx-kpis">
        <div className="sx-kpi">
          <b>{media.length}</b>
          <span>identity-matched media candidates discovered</span>
        </div>
        <div className="sx-kpi">
          <b>{cap?.status === "ran" ? stats.relevant : "—"}</b>
          <span>
            {cap?.status === "ran"
              ? "potential manipulation signals"
              : "manipulation analysis not run"}
          </span>
        </div>
        <div className="sx-kpi">
          <b>{stats.verified}</b>
          <span>human verified</span>
        </div>
      </div>
      {cap && cap.status !== "ran" ? (
        <div className="sx-note warn" style={{ marginBottom: 14 }}>
          <AlertTriangle size={15} />
          <span>
            {media.length} media candidate{media.length === 1 ? "" : "s"} discovered · AI
            manipulation analysis unavailable ({cap.reason}). Candidates are not deepfake findings.
          </span>
        </div>
      ) : null}
      {signals.length ? (
        <div className="sx-cards">
          {signals.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              onOpen={onOpen}
              index={i}
              extra={
                f.confidence != null ? (
                  <span className="sx-tag violet">confidence {f.confidence}%</span>
                ) : null
              }
            />
          ))}
        </div>
      ) : cap?.status === "ran" ? (
        <div className="sx-empty">
          <b>No relevant manipulation signals discovered</b>
          in currently scanned sources.
        </div>
      ) : null}
      {media.length ? (
        <>
          <div className="sx-eyebrow" style={{ margin: "22px 0 10px" }}>
            Media candidates (not findings)
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 10,
            }}
          >
            {media.slice(0, 24).map((d) => (
              <a
                key={d.id}
                href={d.original_url}
                target="_blank"
                rel="noreferrer noopener"
                className="sx-panel"
                style={{ padding: 8, textDecoration: "none" }}
              >
                <span className="sx-thumb" style={{ width: "100%" }}>
                  {d.thumbnail_url ? (
                    <img src={d.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="sx-mono">{d.media_kind}</span>
                  )}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 6,
                    fontSize: 11.5,
                    color: "var(--sx-ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.title ?? hostOf(d.original_url)}
                </span>
                <span className="sx-mono" style={{ fontSize: 10, color: "var(--sx-faint)" }}>
                  {d.platform} · {d.identity_confidence}%
                </span>
              </a>
            ))}
          </div>
        </>
      ) : !cap ? (
        <div className="sx-empty">
          <b>Waiting for media discovery</b>
          Candidates appear here as providers return them.
        </div>
      ) : null}
      <PendingIdentityNote count={stats.pendingIdentity} />
    </>
  );
}

/* ── 02 Reputation ──────────────────────────────────────────────────────── */

function ReputationView({ snap, onOpen }: { snap: Snap; onOpen: (id: string) => void }) {
  const all = matchedOnly(joinFindings(snap, "harmful_content"));
  const stats = snap.analysis.stages.harmful_content;
  const types = ["Articles", "Videos", "Social posts", "Forums", "Other web pages"] as const;
  const byType = new Map<string, number>();
  for (const f of all) {
    if (!f.discovery) continue;
    const t = sourceTypeOf(f.discovery);
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  return (
    <>
      <StageHead
        n="02"
        title="Harmful & Reputation-Risk Content"
        copy="Potentially harmful references are classified for review priority. A classification never states that an allegation is true."
        status={
          <StageStatus
            snap={snap}
            stage="harmful_content"
            doneText="Reputation analysis complete"
          />
        }
      />
      <div className="sx-bigcount">
        <b className="sx-num">{stats.relevant}</b>
        <span>potentially harmful reference{stats.relevant === 1 ? "" : "s"} discovered</span>
      </div>
      <div className="sx-kpis">
        {types.map((t) => (
          <div className="sx-kpi" key={t}>
            <b>{byType.get(t) ?? 0}</b>
            <span>{t}</span>
          </div>
        ))}
      </div>
      <PendingIdentityNote count={stats.pendingIdentity} />
      {all.length ? (
        <div className="sx-cards">
          {all.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              onOpen={onOpen}
              index={i}
              extra={
                <span className="sx-tag mute">published {fmtDate(f.discovery?.published_at)}</span>
              }
            />
          ))}
        </div>
      ) : (
        <div className="sx-empty">
          <b>No potentially harmful references discovered</b>
          {railStates(snap).harmful_content === "done"
            ? "in the scanned sources."
            : "yet — items appear as they are classified."}
        </div>
      )}
    </>
  );
}

/* ── 03 Impersonation ───────────────────────────────────────────────────── */

function ImpersonationView({ snap, onOpen }: { snap: Snap; onOpen: (id: string) => void }) {
  const all = joinFindings(snap, "impersonation").filter(
    (f) => f.state !== "REJECTED" && f.discovery?.identity_bucket !== "UNRELATED",
  );
  const stats = snap.analysis.stages.impersonation;
  return (
    <>
      <StageHead
        n="03"
        title="Identity Impersonation"
        copy="Profiles, pages and endorsements that appear to represent the identity. Staff decide: confirmed official, possible impersonation, not related, or escalate."
        status={
          <StageStatus snap={snap} stage="impersonation" doneText="Identity analysis complete" />
        }
      />
      <div className="sx-bigcount">
        <b className="sx-num">{stats.relevant}</b>
        <span>potential impersonation signal{stats.relevant === 1 ? "" : "s"} discovered</span>
      </div>
      {all.length ? (
        <div className="sx-cards">
          {all.map((f, i) => (
            <FindingCard key={f.id} f={f} onOpen={onOpen} index={i} />
          ))}
        </div>
      ) : (
        <div className="sx-empty">
          <b>No relevant impersonation signals discovered.</b>
          {(snap.identity?.known_handles as unknown[] | undefined)?.length
            ? "Profiles are compared against the official handles you supplied."
            : "Tip: add official handles when starting a scan so look-alike profiles can be flagged."}
        </div>
      )}
      <CapabilityNote snap={snap} stage="impersonation" />
    </>
  );
}

/* ── 04 Privacy ─────────────────────────────────────────────────────────── */

function PrivacyView({ snap, onOpen }: { snap: Snap; onOpen: (id: string) => void }) {
  const all = matchedOnly(joinFindings(snap, "privacy_exposure"));
  const stats = snap.analysis.stages.privacy_exposure;
  return (
    <>
      <StageHead
        n="04"
        title="Privacy Exposure"
        copy="Lawfully accessible public pages only. Sensitive values are masked in this interface; open the evidence to see the stored, masked excerpt."
        status={
          <StageStatus snap={snap} stage="privacy_exposure" doneText="Privacy analysis complete" />
        }
      />
      <div className="sx-bigcount">
        <b className="sx-num">{stats.relevant}</b>
        <span>potential privacy exposure{stats.relevant === 1 ? "" : "s"} discovered</span>
      </div>
      <PendingIdentityNote count={stats.pendingIdentity} />
      {all.length ? (
        <div className="sx-cards">
          {all.map((f, i) => (
            <FindingCard key={f.id} f={f} onOpen={onOpen} index={i} />
          ))}
        </div>
      ) : (
        <div className="sx-empty">
          <b>No public privacy-exposure signals discovered</b>
          in the scanned sources.
        </div>
      )}
      <div className="sx-note info" style={{ marginTop: 14 }}>
        <ShieldCheck size={15} />
        <span>Potential privacy findings require verification before any response action.</span>
      </div>
    </>
  );
}

/* ── 05 Search reputation ───────────────────────────────────────────────── */

function SearchView({ snap, onOpen }: { snap: Snap; onOpen: (id: string) => void }) {
  const s = snap.analysis.search;
  const findings = joinFindings(snap, "search_reputation");
  const byDiscovery = new Map(findings.map((f) => [f.discovery_id, f]));
  const ranks = new Map<string, number>();
  for (const o of snap.observations) {
    if (o.query_purpose !== "identity_primary" || typeof o.result_rank !== "number") continue;
    const p = ranks.get(o.discovery_id);
    if (p === undefined || o.result_rank < p) ranks.set(o.discovery_id, o.result_rank);
  }
  const rows = snap.discoveries
    .filter((d) => ranks.has(d.id) && d.identity_bucket !== "UNRELATED")
    .sort((a, b) => (ranks.get(a.id) ?? 99) - (ranks.get(b.id) ?? 99))
    .slice(0, 20);
  return (
    <>
      <StageHead
        n="05"
        title="Search Reputation"
        copy="What people see when they search the plain name. Percentages are computed only from the identity-matched results actually analysed; ranks are the providers' observed ranks."
        status={
          <StageStatus
            snap={snap}
            stage="search_reputation"
            doneText="Search reputation analysis complete"
          />
        }
      />
      {s.analysed ? (
        <div className="sx-panel" style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0,1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <Pct label="Positive" v={s.pct.positive} n={s.positive} color="var(--sx-ok)" />
            <Pct label="Neutral" v={s.pct.neutral} n={s.neutral} color="var(--sx-muted)" />
            <Pct
              label="Potential risk"
              v={s.pct.potentialRisk}
              n={s.potentialRisk}
              color="var(--sx-risk)"
            />
          </div>
          <div className="sx-bar">
            <i style={{ width: `${s.pct.positive}%`, background: "var(--sx-ok)" }} />
            <i style={{ width: `${s.pct.neutral}%`, background: "var(--sx-faint)" }} />
            <i style={{ width: `${s.pct.potentialRisk}%`, background: "var(--sx-risk)" }} />
          </div>
          <div
            className="sx-mono"
            style={{ fontSize: 11, color: "var(--sx-faint)", marginTop: 10 }}
          >
            Based on {s.analysed} analysed result{s.analysed === 1 ? "" : "s"}
          </div>
        </div>
      ) : (
        <div className="sx-empty" style={{ marginBottom: 14 }}>
          <b>No identity-matched ranked results analysed yet</b>
          Percentages appear only once real ranked results are stored.
        </div>
      )}
      {rows.length ? (
        <div className="sx-panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="sx-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Title</th>
                <th>Source</th>
                <th>Category</th>
                <th>Risk status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const f = byDiscovery.get(d.id);
                const risk = f?.category === "Potential risk result";
                return (
                  <tr
                    key={d.id}
                    className={risk ? "risk" : ""}
                    style={{ cursor: f ? "pointer" : undefined }}
                    onClick={() => f && onOpen(f.id)}
                  >
                    <td className="sx-num">#{ranks.get(d.id)}</td>
                    <td style={{ color: "var(--sx-ink)" }}>{d.title ?? hostOf(d.original_url)}</td>
                    <td className="sx-mono" style={{ fontSize: 11.5 }}>
                      {hostOf(d.original_url)}
                    </td>
                    <td>
                      {f?.category ??
                        (d.identity_bucket === "MATCHED" ? "—" : IDENTITY_LABEL[d.identity_bucket])}
                    </td>
                    <td>
                      {f ? (
                        <span className={`sx-tag ${risk ? "risk" : stateTone(f.state)}`}>
                          {risk ? FINDING_STATE_LABEL[f.state] : "No risk signal"}
                        </span>
                      ) : (
                        <span className="sx-tag mute">Not classified</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="sx-note info" style={{ marginTop: 14 }}>
        <Info size={15} />
        <span>
          Search visibility matters because high-ranking harmful content can shape first
          impressions.
        </span>
      </div>
    </>
  );
}

function Pct({ label, v, n, color }: { label: string; v: number; n: number; color: string }) {
  return (
    <div>
      <div className="sx-num" style={{ fontSize: 30, color }}>
        {v}%
      </div>
      <div style={{ fontSize: 12, color: "var(--sx-muted)", marginTop: 4 }}>
        {label} · {n}
      </div>
    </div>
  );
}

/* ── 06 Propagation ─────────────────────────────────────────────────────── */

interface ClusterView {
  id: string;
  member_count: number;
  earliest_discovery_id: string;
  prospect_cluster_members: Array<{
    discovery_id: string;
    is_earliest_discovered: boolean;
    link_evidence: { reasons?: string[] };
  }>;
}

function PropagationView({ snap, onOpen }: { snap: Snap; onOpen: (id: string) => void }) {
  const clusters = snap.clusters as unknown as ClusterView[];
  const byId = new Map(snap.discoveries.map((d) => [d.id, d]));
  const copies = joinFindings(snap, "propagation").filter((f) => f.state !== "REJECTED");
  const findingByDiscovery = new Map(copies.map((f) => [f.discovery_id, f]));
  const platforms = new Set<string>();
  let copyCount = 0;
  for (const c of clusters) {
    for (const m of c.prospect_cluster_members ?? []) {
      const d = byId.get(m.discovery_id);
      if (d?.platform) platforms.add(d.platform);
      if (!m.is_earliest_discovered) copyCount++;
    }
  }
  return (
    <>
      <StageHead
        n="06"
        title="Content Propagation"
        copy="Related copies grouped by identical retrieved content, near-identical titles and shared video references. Origin is never assumed: the first item is the earliest discovered source."
        status={
          <StageStatus snap={snap} stage="propagation" doneText="Propagation analysis complete" />
        }
      />
      <div className="sx-kpis">
        <div className="sx-kpi">
          <b>{clusters.length}</b>
          <span>source items (earliest discovered)</span>
        </div>
        <div className="sx-kpi">
          <b>{copyCount}</b>
          <span>related copies / reposts</span>
        </div>
        <div className="sx-kpi">
          <b>{platforms.size}</b>
          <span>platforms involved</span>
        </div>
      </div>
      {clusters.length ? (
        <div style={{ display: "grid", gap: 12 }}>
          {clusters.map((c) => (
            <ClusterGraph
              key={c.id}
              cluster={c}
              byId={byId}
              onOpen={(did) => {
                const f = findingByDiscovery.get(did);
                if (f) onOpen(f.id);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="sx-empty">
          <b>No related copies discovered</b>
          {railStates(snap).propagation === "done"
            ? "in the scanned sources."
            : "yet — clustering runs after discovery."}
        </div>
      )}
      <CapabilityNote snap={snap} stage="propagation" />
    </>
  );
}

function ClusterGraph({
  cluster,
  byId,
  onOpen,
}: {
  cluster: ClusterView;
  byId: Map<string, Snap["discoveries"][number]>;
  onOpen: (discoveryId: string) => void;
}) {
  const members = cluster.prospect_cluster_members ?? [];
  const earliest = members.find((m) => m.is_earliest_discovered) ?? members[0];
  const others = members.filter((m) => m !== earliest).slice(0, 8);
  const h = Math.max(120, others.length * 46 + 30);
  const src = earliest ? byId.get(earliest.discovery_id) : undefined;
  const nodeY = (i: number) => 25 + i * 46 + (h - 30 - others.length * 46) / 2 + 20;
  return (
    <div className="sx-panel" style={{ overflowX: "auto" }}>
      <svg
        className="sx-graph"
        viewBox={`0 0 640 ${h}`}
        style={{ minWidth: 520 }}
        role="img"
        aria-label={`Cluster of ${members.length} related items`}
      >
        {others.map((m, i) => {
          const y = nodeY(i);
          const d = `M210 ${h / 2} C 300 ${h / 2}, 320 ${y}, 400 ${y}`;
          return (
            <g key={m.discovery_id}>
              <path
                className="edge"
                d={d}
                pathLength={1}
                style={{ animationDelay: `${i * 90}ms` }}
              />
              <path className="flow" d={d} pathLength={1} />
            </g>
          );
        })}
        <g style={{ cursor: "default" }}>
          <rect
            x="16"
            y={h / 2 - 30}
            width="194"
            height="60"
            rx="14"
            fill="rgba(91,140,255,0.12)"
            stroke="rgba(91,140,255,0.45)"
          />
          <text x="30" y={h / 2 - 10} className="sub">
            EARLIEST DISCOVERED SOURCE
          </text>
          <text x="30" y={h / 2 + 8}>
            {truncate(hostOf(src?.original_url), 26)}
          </text>
          <text x="30" y={h / 2 + 22} className="sub">
            {src?.platform ?? "Web"} · {fmtDate(src?.published_at ?? src?.retrieved_at)}
          </text>
        </g>
        {others.map((m, i) => {
          const d = byId.get(m.discovery_id);
          const y = nodeY(i);
          return (
            <g
              key={m.discovery_id}
              style={{ cursor: "pointer" }}
              onClick={() => onOpen(m.discovery_id)}
            >
              <rect
                x="400"
                y={y - 17}
                width="226"
                height="34"
                rx="10"
                fill="rgba(155,133,255,0.1)"
                stroke="rgba(155,133,255,0.4)"
              />
              <text x="412" y={y - 1}>
                {truncate(hostOf(d?.original_url), 28)}
              </text>
              <text x="412" y={y + 11} className="sub">
                {truncate(
                  `${d?.platform ?? "Web"} · ${(m.link_evidence?.reasons ?? [])[0] ?? "linked"}`,
                  32,
                )}
              </text>
              <title>{(m.link_evidence?.reasons ?? []).join(", ")}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string | undefined, n: number) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ── Human verification ─────────────────────────────────────────────────── */

function ReviewView({
  snap,
  onOpen,
  onIdentity,
  busy,
}: {
  snap: Snap;
  onOpen: (id: string) => void;
  onIdentity: (discoveryId: string, decision: "MATCHED" | "UNRELATED") => void;
  busy?: boolean;
}) {
  const awaiting = joinFindings(snap)
    .filter(
      (f) =>
        f.discovery?.identity_bucket === "MATCHED" &&
        ["DISCOVERED", "CLASSIFIED", "NEEDS_HUMAN_REVIEW"].includes(f.state),
    )
    .filter((f) => f.stage_key !== "search_reputation" || f.category === "Potential risk result");
  const queue = snap.discoveries.filter(
    (d) => d.identity_bucket === "POSSIBLE_MATCH" || d.identity_bucket === "NEEDS_IDENTITY_REVIEW",
  );
  const findingCountFor = (id: string) => snap.findings.filter((f) => f.discovery_id === id).length;
  return (
    <>
      <StageHead
        n="✓"
        title="Human Verification"
        copy="Discovered → Human verified → Eligible for response only after enrollment and authorization. Automated classification never verifies anything."
        status={<span className="sx-chip c-violet">Staff decisions are audited</span>}
      />
      <div className="sx-eyebrow" style={{ marginBottom: 10 }}>
        Findings awaiting verification · {awaiting.length}
      </div>
      {awaiting.length ? (
        <div className="sx-cards">
          {awaiting.map((f, i) => (
            <FindingCard key={f.id} f={f} onOpen={onOpen} index={i} />
          ))}
        </div>
      ) : (
        <div className="sx-empty">
          <b>Nothing awaiting verification</b>
        </div>
      )}
      <div className="sx-eyebrow" style={{ margin: "24px 0 10px" }}>
        Needs identity verification · {queue.length}
      </div>
      {queue.length ? (
        <div className="sx-cards">
          {queue.map((d) => (
            <div key={d.id} className="sx-card no-thumb" style={{ cursor: "default" }}>
              <span style={{ minWidth: 0 }}>
                <span className="sx-card-t">{d.title ?? hostOf(d.original_url)}</span>
                <a
                  className="sx-card-u"
                  style={{ display: "block" }}
                  href={d.original_url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {d.original_url}
                </a>
                <span className="sx-card-x">{d.identity_explanation}</span>
                <span className="sx-card-m" style={{ justifyContent: "space-between" }}>
                  <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span className={`sx-tag ${identityTone(d.identity_bucket)}`}>
                      {IDENTITY_LABEL[d.identity_bucket]}
                    </span>
                    <span className="sx-tag mute">{findingCountFor(d.id)} held finding(s)</span>
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="sx-btn sm"
                      disabled={busy}
                      onClick={() => onIdentity(d.id, "UNRELATED")}
                    >
                      Not related
                    </button>
                    <button
                      type="button"
                      className="sx-btn sm primary"
                      disabled={busy}
                      onClick={() => onIdentity(d.id, "MATCHED")}
                    >
                      Confirm identity
                    </button>
                  </span>
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="sx-empty">
          <b>No items need identity verification</b>
        </div>
      )}
    </>
  );
}

/* ── 07 Summary ─────────────────────────────────────────────────────────── */

function SummaryView({ snap, onJump }: { snap: Snap; onJump: (k: RailKey | "review") => void }) {
  const a = snap.analysis;
  const cov = a.coverage;
  const pre = snap.scores.preliminary;
  const ver = snap.scores.verified;
  const name = String(snap.identity?.display_name ?? "");
  const cats: Array<{ key: RailKey; label: string }> = [
    { key: "ai_manipulation", label: "Deepfake / manipulation" },
    { key: "harmful_content", label: "Reputation-risk content" },
    { key: "impersonation", label: "Impersonation" },
    { key: "privacy_exposure", label: "Privacy" },
    { key: "search_reputation", label: "Search risk" },
    { key: "propagation", label: "Propagation / reuploads" },
  ];
  const groups = useMemo(() => {
    const ok = snap.sources.filter((s) => s.state === "results_found" || s.state === "no_results");
    const failed = snap.sources.filter((s) => s.state === "provider_error");
    const unavailable = snap.sources.filter(
      (s) => s.state === "unavailable" || s.state === "not_scanned",
    );
    const policy = snap.sources.filter((s) => s.state === "policy_disabled");
    return { ok, failed, unavailable, policy };
  }, [snap.sources]);
  const zero = a.counts.relevantItems === 0;
  return (
    <>
      <div className="sx-eyebrow" style={{ color: "var(--sx-ok)" }}>
        {isFinished(snap.scan.status)
          ? "Scan complete · stored records only"
          : "Assessment will finalise when the scan completes"}
      </div>
      <h3
        className="sx-display"
        style={{ margin: "8px 0 2px", fontSize: 30, fontWeight: 600, letterSpacing: "-0.03em" }}
      >
        Digital Exposure Intelligence
      </h3>
      <div style={{ color: "var(--sx-muted)", fontSize: 15, marginBottom: 18 }}>{name}</div>

      {zero && isFinished(snap.scan.status) ? (
        <div className="sx-note" style={{ marginBottom: 14 }}>
          <Info size={15} />
          <span>{zeroFindingsLabel(cov.state)}</span>
        </div>
      ) : null}

      <div className="sx-cat-grid" style={{ marginBottom: 14 }}>
        {cats.map((cat) => {
          const s = a.stages[cat.key as keyof typeof a.stages];
          const unavailable =
            cat.key === "ai_manipulation" && s.capability?.status === "unavailable";
          return (
            <button key={cat.key} type="button" className="sx-cat" onClick={() => onJump(cat.key)}>
              <span>
                <span>{cat.label}</span>
                <b className="sx-num">{unavailable ? "—" : s.relevant}</b>
              </span>
              <small>
                {unavailable
                  ? "analysis unavailable"
                  : `${s.verified} verified · ${s.awaitingVerification} awaiting`}
              </small>
            </button>
          );
        })}
      </div>

      <div className="sx-kpis">
        <div className="sx-kpi">
          <b>{a.counts.totalRelevantSignals}</b>
          <span>total relevant signals</span>
        </div>
        <div className="sx-kpi">
          <b>{a.counts.needsVerification}</b>
          <span>findings awaiting verification</span>
        </div>
        <div className="sx-kpi">
          <b>{a.counts.identityReviewQueue}</b>
          <span>items awaiting identity verification</span>
        </div>
        <div className="sx-kpi">
          <b style={{ color: a.counts.verifiedHighPriority ? "var(--sx-risk)" : undefined }}>
            {a.counts.verifiedHighPriority}
          </b>
          <span>verified high-priority findings</span>
        </div>
      </div>

      <div className="sx-assess" style={{ marginBottom: 14 }}>
        <Assessment
          title="Preliminary Exposure Signal"
          badge={<span className="sx-chip c-warn">Preliminary · Not yet human verified</span>}
          score={pre}
          whyLabel="Why this preliminary signal?"
          detail={`Based on ${a.counts.totalRelevantSignals} real discovered signal${a.counts.totalRelevantSignals === 1 ? "" : "s"} · ${a.counts.needsVerification} awaiting verification`}
        />
        <Assessment
          title="Verified Risk Assessment"
          badge={<span className="sx-chip c-ok">Human-verified findings only</span>}
          score={ver}
          whyLabel="Why this verified assessment?"
          detail={
            ver?.band === "PENDING_VERIFICATION"
              ? "No findings have been human verified yet."
              : undefined
          }
        />
      </div>

      <div className="sx-panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <div>
            <div className="sx-eyebrow">Coverage</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 6 }}>
              {coverageWord(cov.state)} — {cov.queriedOk}/{cov.intended + cov.policyDisabled} source
              families queried
            </div>
          </div>
          {cov.qualified ? (
            <span className="sx-chip c-warn">Risk assessment based on available sources</span>
          ) : null}
        </div>
        <CoverageGroup
          label="Successfully scanned"
          tone="ok"
          items={groups.ok.map((s) => s.family_label)}
        />
        <CoverageGroup
          label="Failed"
          tone="risk"
          items={groups.failed.map(
            (s) => `${s.family_label}${s.failure_reason ? ` (${s.failure_reason})` : ""}`,
          )}
        />
        <CoverageGroup
          label="Unavailable — not scanned"
          tone="warn"
          items={groups.unavailable.map((s) => s.family_label)}
        />
        <CoverageGroup
          label="Policy-disabled"
          tone="mute"
          items={groups.policy.map((s) => s.family_label)}
        />
        <p style={{ fontSize: 12, color: "var(--sx-faint)", margin: "10px 0 0" }}>
          Incomplete coverage is never read as low risk. URLs from unavailable platforms can still
          appear when surfaced by web search; the platform itself was not scanned.
        </p>
      </div>
    </>
  );
}

function CoverageGroup({ label, tone, items }: { label: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div
      style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: 8, flexWrap: "wrap" }}
    >
      <span className={`sx-tag ${tone}`}>{label}</span>
      <span style={{ fontSize: 12.5, color: "var(--sx-ink-2)" }}>{items.join(" · ")}</span>
    </div>
  );
}

function Assessment({
  title,
  badge,
  score,
  whyLabel,
  detail,
}: {
  title: string;
  badge: ReactNode;
  score: Snap["scores"]["preliminary"];
  whyLabel: string;
  detail?: string;
}) {
  const [open, setOpen] = useState(false);
  const factors = (score?.factors?.factors ?? []).filter((f) => f.contribution > 0);
  const band = score?.band ?? "PENDING_VERIFICATION";
  return (
    <div className="sx-assess-card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span className="sx-eyebrow">{title}</span>
        {badge}
      </div>
      <div className={`band sx-band-${band}`}>{score ? bandLabel(band) : "Computing…"}</div>
      <div className="q">{score?.factors?.qualifier ?? detail}</div>
      {detail && score?.factors?.qualifier ? <div className="q">{detail}</div> : null}
      <button
        type="button"
        className="sx-btn ghost sm"
        style={{ marginTop: 8, paddingLeft: 0 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {whyLabel}
      </button>
      {open ? (
        <div className="sx-why">
          {factors.length ? (
            factors.map((f) => (
              <div key={f.key} className="sx-why-row" title={f.detail}>
                <span>
                  {f.label}
                  <span style={{ display: "block", fontSize: 11, color: "var(--sx-faint)" }}>
                    {f.detail}
                  </span>
                </span>
                <span className="track">
                  <i
                    style={{
                      width: `${Math.min(100, (f.contribution / Math.max(f.max, 0.1)) * 100)}%`,
                    }}
                  />
                </span>
                <b>+{f.contribution}</b>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--sx-muted)" }}>
              No contributing factors — no qualifying findings.
            </div>
          )}
          {score ? (
            <div
              className="sx-mono"
              style={{ fontSize: 10.5, color: "var(--sx-faint)", marginTop: 4 }}
            >
              model {score.model_version} · {score.total_points} points ·{" "}
              {fmtDate(score.created_at)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
