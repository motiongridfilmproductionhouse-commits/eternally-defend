import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ScanSnapshotView } from "@/lib/prospect/snapshot.server";
import { hostOf, joinFindings } from "./staff-model";

export interface EnrollmentResult {
  prospectScanId: string;
  transferred: number;
  alreadyTransferred: number;
  identityPackaged: boolean;
  inviteCode: string | null;
  inviteNote: string | null;
  packageId?: string;
  linkedExistingAccount?: boolean;
}

export function EnrollmentDialog({
  snap,
  busy,
  result,
  error,
  onClose,
  onSubmit,
}: {
  snap: ScanSnapshotView;
  busy: boolean;
  result: EnrollmentResult | null;
  error: string | null;
  onClose: () => void;
  onSubmit: (findingIds: string[], clientEmail: string) => void;
}) {
  const eligible = useMemo(
    () =>
      joinFindings(snap).filter(
        (f) =>
          (f.state === "VERIFIED" || f.state === "ESCALATED") &&
          f.discovery?.identity_bucket === "MATCHED",
      ),
    [snap],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligible.map((f) => f.id)));
  const [email, setEmail] = useState("");

  return (
    <>
      <div className="sx-drawer-scrim" onClick={onClose} />
      <aside
        className="sx-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Begin client enrollment"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "18px 24px",
            borderBottom: "1px solid var(--sx-line)",
          }}
        >
          <div>
            <div className="sx-eyebrow">Begin client enrollment</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>
              {String(snap.identity?.display_name ?? "")}
            </div>
          </div>
          <button type="button" className="sx-iconbtn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="sx-drawer-b">
          <div className="sx-note info" style={{ marginBottom: 14 }}>
            <span>
              The resolved identity, official handles, known works, linked entities and the selected
              human-verified findings (with their evidence references) are packaged for onboarding
              under prospect scan{" "}
              <span className="sx-mono">{String(snap.scan.id).slice(0, 8)}</span>. No enforcement
              can start until the client is enrolled and authorised. When the client redeems the
              invitation (or an admin links an existing account by email), onboarding pre-fills
              their profile and imports these findings for their review.
            </span>
          </div>
          {result ? (
            <div className="sx-panel">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                {result.linkedExistingAccount
                  ? "Delivered to the client account"
                  : "Enrollment package ready"}
              </div>
              <div style={{ fontSize: 13, color: "var(--sx-ink-2)", lineHeight: 1.6 }}>
                {result.transferred} finding(s) transferred · {result.alreadyTransferred} already
                transferred earlier · identity{" "}
                {result.identityPackaged ? "packaged" : "not packaged"}
                {result.inviteCode ? (
                  <>
                    <br />
                    Invitation code (shown once):{" "}
                    <span className="sx-mono" style={{ color: "var(--sx-cyan)" }}>
                      {result.inviteCode}
                    </span>
                  </>
                ) : null}
                {result.inviteNote ? (
                  <>
                    <br />
                    {result.inviteNote}
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="sx-eyebrow" style={{ marginBottom: 8 }}>
                Human-verified findings · {eligible.length}
              </div>
              {eligible.length ? (
                <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
                  {eligible.map((f) => (
                    <label
                      key={f.id}
                      className="sx-panel"
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "10px 12px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(f.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(f.id);
                            else next.delete(f.id);
                            return next;
                          })
                        }
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                          {f.category}
                        </span>
                        <span
                          className="sx-mono"
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "var(--sx-blue)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {hostOf(f.discovery?.original_url)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="sx-empty" style={{ marginBottom: 16 }}>
                  <b>No human-verified findings yet</b>
                  You can still hand over the verified identity; findings can be verified and
                  transferred later.
                </div>
              )}
              <div className="sx-field" style={{ marginBottom: 14 }}>
                <label htmlFor="sx-client-email">
                  Client email for invitation (optional, admins only)
                </label>
                <input
                  id="sx-client-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              {error ? (
                <div className="sx-note warn" style={{ marginBottom: 12 }}>
                  {error}
                </div>
              ) : null}
              <button
                type="button"
                className="sx-btn primary"
                disabled={busy}
                onClick={() => onSubmit(Array.from(selected), email)}
              >
                {busy ? "Packaging…" : "Begin Client Enrollment"}
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
