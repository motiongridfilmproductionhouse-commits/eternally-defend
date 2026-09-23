import { useEffect } from "react";
import { AlertTriangle, ArrowLeft, RefreshCw, X } from "lucide-react";
import { IntelligenceCore } from "./ScanModal";
import { RAIL } from "./staff-model";

/**
 * The scan experience before the stored snapshot has arrived (or when it could
 * not be loaded). Same scrim, modal frame, core and stage rail as ScanModal, so
 * the hand-over is seamless — the search page is never left visible once a
 * scan id exists. Nothing here is scan data: no counts, sources or findings
 * are shown until they are read from the database.
 */
export function ScanShell({
  logoSrc,
  state,
  errorMessage,
  retrying,
  onRetry,
  onReturn,
}: {
  logoSrc: string;
  state: "initializing" | "error";
  errorMessage?: string | null;
  retrying?: boolean;
  onRetry: () => void;
  onReturn: () => void;
}) {
  const failed = state === "error";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onReturn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onReturn]);

  return (
    <>
      <div className="sx-scrim" />
      <section
        className="sx-modal"
        role="dialog"
        aria-modal="true"
        aria-busy={!failed}
        aria-label={failed ? "Unable to load scan" : "Initializing live intelligence scan"}
      >
        <header className="sx-mh">
          <IntelligenceCore logoSrc={logoSrc} running={!failed} />
          <div style={{ minWidth: 0 }}>
            <div className="sx-eyebrow" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>Scanning Digital Exposure</span>
              <span className="sx-chip c-violet" style={{ height: 20 }}>
                Pre-enrollment · prospect intelligence
              </span>
            </div>
            <h2 className="sx-display">
              {failed ? "Unable to load scan" : "Initializing live intelligence scan…"}
            </h2>
            <div className="live-line" aria-live="polite">
              <span className={`sx-eq${failed ? " is-idle" : ""}`} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {failed
                  ? "The scan is stored on the server and keeps running; only this view failed to load."
                  : "Connecting to the stored scan record…"}
              </span>
            </div>
          </div>
          <div className="sx-mh-right">
            <button
              type="button"
              className="sx-iconbtn"
              onClick={onReturn}
              aria-label="Return to search"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="sx-sources" aria-label="Source status">
          <span className="sx-src" data-state="connecting">
            <span className="d" />
            {failed ? "Source status unavailable" : "Preparing source families"}
          </span>
        </div>

        <div className="sx-mb">
          <nav className="sx-rail" aria-label="Analysis stages">
            {RAIL.map((r, i) => (
              <div
                key={r.key}
                className="sx-rail-item"
                data-state={!failed && i === 0 ? "active" : "waiting"}
                aria-disabled="true"
              >
                <span className="sx-ind">{r.n}</span>
                <span>
                  <span className="sx-rail-t" style={{ display: "block" }}>
                    {r.n} {r.label}
                  </span>
                  <span className="sx-rail-s" style={{ display: "block" }}>
                    {!failed && i === 0 ? "Initializing…" : "Waiting"}
                  </span>
                </span>
              </div>
            ))}
          </nav>

          <main className="sx-ws">
            <div
              className="sx-view"
              style={{ display: "grid", placeItems: "center", minHeight: 320, textAlign: "center" }}
            >
              {failed ? (
                <div role="alert" style={{ maxWidth: 460 }}>
                  <AlertTriangle
                    size={28}
                    style={{ color: "var(--sx-warn)", display: "block", margin: "0 auto" }}
                  />
                  <h3 style={{ margin: "12px 0 6px", fontSize: 20 }}>Unable to load scan</h3>
                  <p style={{ color: "var(--sx-muted)", fontSize: 13.5, lineHeight: 1.6 }}>
                    {errorMessage || "The scan could not be loaded."} Retrying reloads this same
                    scan — it never starts a new one.
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      justifyContent: "center",
                      marginTop: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      className="sx-btn primary"
                      onClick={onRetry}
                      disabled={retrying}
                    >
                      <RefreshCw size={14} />
                      {retrying ? "Retrying…" : "Retry"}
                    </button>
                    <button type="button" className="sx-btn" onClick={onReturn}>
                      <ArrowLeft size={14} />
                      Return to Search
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ maxWidth: 420 }}>
                  <p className="sx-eyebrow" style={{ marginBottom: 10 }}>
                    Stage 01 · Deepfake &amp; AI Manipulation
                  </p>
                  <p style={{ color: "var(--sx-muted)", fontSize: 13.5, lineHeight: 1.6 }}>
                    Initializing live intelligence scan… Results appear here as soon as they are
                    stored.
                  </p>
                </div>
              )}
            </div>
          </main>

          <aside className="sx-stream" aria-label="Live discovery stream">
            <div className="sx-stream-h">
              <span className="sx-eyebrow">Live discovery stream</span>
            </div>
            <div className="sx-stream-list">
              <div className="sx-ev">
                <span className="d" />
                <span>
                  {failed
                    ? "Stream unavailable until the scan loads."
                    : "Waiting for stored events…"}
                </span>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
