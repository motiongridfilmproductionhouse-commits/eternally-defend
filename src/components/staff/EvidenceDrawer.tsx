import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import type { EvidencePayload } from "@/lib/prospect/scan.functions";
import { discoveryMethodLabel } from "@/lib/prospect/events";
import {
  FINDING_STATE_LABEL,
  IDENTITY_LABEL,
  fmtDate,
  fmtTime,
  identityTone,
  stateTone,
} from "./staff-model";

export type DecisionAction = "VERIFY" | "REJECT" | "NEEDS_REVIEW" | "ESCALATE";

const RESPONSE_PATH: Record<string, string> = {
  ai_manipulation:
    "After enrollment: forensic media review, then platform synthetic-media / deepfake reporting if verified.",
  harmful_content:
    "After enrollment: legal/communications review; removal or right-of-reply only where the content is verified as false or unlawful.",
  impersonation: "After enrollment: platform impersonation report with ownership evidence.",
  privacy_exposure:
    "After enrollment: privacy/doxxing removal request to the host and search delisting where eligible.",
  search_reputation:
    "After enrollment: search reputation strategy; delisting only where policy-eligible.",
  propagation: "After enrollment: group notices across the cluster so copies are handled together.",
};

function s(v: unknown): string {
  return v == null ? "" : String(v);
}

export function EvidenceDrawer({
  data,
  loading,
  busy,
  onClose,
  onDecision,
  onIdentity,
}: {
  data: EvidencePayload | null;
  loading: boolean;
  busy: boolean;
  onClose: () => void;
  onDecision: (action: DecisionAction, reason: string, reclassifyAs?: string) => void;
  onIdentity: (decision: "MATCHED" | "UNRELATED", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const f = data?.finding;
  const d = data?.discovery;
  const stage = s(f?.stage_key);
  const factors = (Array.isArray(d?.identity_factors) ? d?.identity_factors : []) as Array<{
    label?: string;
    points?: number;
    strong?: boolean;
  }>;
  const bucket = s(d?.identity_bucket);
  const isImpersonation = stage === "impersonation";

  return (
    <>
      <div className="sx-drawer-scrim" onClick={onClose} />
      <aside className="sx-drawer" role="dialog" aria-modal="true" aria-label="Evidence">
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
            <div className="sx-eyebrow">Evidence · prospect intelligence</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>{s(f?.category) || "Loading…"}</div>
          </div>
          <button
            type="button"
            className="sx-iconbtn"
            onClick={onClose}
            aria-label="Close evidence"
          >
            <X size={16} />
          </button>
        </div>
        <div className="sx-drawer-b">
          {loading || !f ? (
            <div className="sx-empty">Loading stored evidence…</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                <span className={`sx-tag ${stateTone(s(f.state))}`}>
                  {FINDING_STATE_LABEL[s(f.state)] ?? s(f.state)}
                </span>
                <span className={`sx-tag ${identityTone(bucket)}`}>
                  {IDENTITY_LABEL[bucket] ?? bucket}
                </span>
                <span className="sx-tag mute">severity {s(f.severity)}/10</span>
                {f.confidence != null ? (
                  <span className="sx-tag violet">confidence {s(f.confidence)}%</span>
                ) : null}
              </div>

              {d?.thumbnail_url ? (
                <img
                  src={s(d.thumbnail_url)}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{
                    width: "100%",
                    maxHeight: 240,
                    objectFit: "cover",
                    borderRadius: 14,
                    border: "1px solid var(--sx-line)",
                    marginBottom: 14,
                  }}
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              ) : null}

              <dl className="sx-dl">
                <dt>Title</dt>
                <dd>{s(d?.title) || "—"}</dd>
                <dt>URL</dt>
                <dd>
                  <a
                    href={s(d?.original_url)}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{
                      color: "var(--sx-blue)",
                      display: "inline-flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    {s(d?.original_url)} <ExternalLink size={12} />
                  </a>
                </dd>
                <dt>Platform</dt>
                <dd>{s(d?.platform) || "Web"}</dd>
                <dt>Discovery method</dt>
                <dd>{discoveryMethodLabel(s(d?.discovery_method))}</dd>
                <dt>Providers</dt>
                <dd>
                  {Array.from(new Set((data?.observations ?? []).map((o) => s(o.provider)))).join(
                    ", ",
                  ) || "—"}
                </dd>
                <dt>Queries</dt>
                <dd>
                  {Array.from(new Set((data?.observations ?? []).map((o) => s(o.query_used)))).join(
                    " · ",
                  ) || "—"}
                </dd>
                <dt>Published</dt>
                <dd>{fmtDate(s(d?.published_at) || null)}</dd>
                <dt>Discovered</dt>
                <dd>
                  {fmtDate(s(d?.retrieved_at))} {fmtTime(s(d?.retrieved_at))}
                </dd>
                <dt>Extraction</dt>
                <dd>{s(d?.extraction_status).replace(/_/g, " ")}</dd>
                <dt>Classification</dt>
                <dd>
                  {s(f.category)} — {s(f.detection_reason)}
                  <div style={{ fontSize: 11, color: "var(--sx-faint)", marginTop: 3 }}>
                    {s(f.classification_version)}
                  </div>
                </dd>
                <dt>Identity confidence</dt>
                <dd>
                  {s(d?.identity_explanation)}
                  {factors.length ? (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 16, color: "var(--sx-muted)" }}>
                      {factors.map((x, i) => (
                        <li key={i}>
                          {x.label} (+{x.points}){x.strong ? " · strong" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </dd>
                <dt>Recommended path</dt>
                <dd>
                  {RESPONSE_PATH[stage] ?? "Review after enrollment."} No action can start from a
                  pre-enrollment scan.
                </dd>
              </dl>

              {(data?.evidence ?? []).map((e, i) => (
                <div key={i} style={{ marginTop: 16 }}>
                  <div className="sx-eyebrow" style={{ marginBottom: 6 }}>
                    Captured evidence · {s(e.capture_kind).replace(/_/g, " ")} ·{" "}
                    {fmtDate(s(e.observed_at))}
                  </div>
                  <div className="sx-quote">
                    {s(e.extracted_text) ||
                      "No text was retrievable for this item (search metadata only)."}
                  </div>
                  <div
                    className="sx-mono"
                    style={{ fontSize: 10.5, color: "var(--sx-faint)", marginTop: 6 }}
                  >
                    content hash {s(e.content_hash) || "—"} · screenshot capture not run for
                    prospect scans
                  </div>
                </div>
              ))}

              <div className="sx-panel" style={{ marginTop: 18 }}>
                <div className="sx-eyebrow" style={{ marginBottom: 8 }}>
                  Staff decision
                </div>
                <textarea
                  id="sx-reason"
                  className="sx-textarea"
                  placeholder="Reason / context (stored in the audit trail)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                {bucket !== "MATCHED" ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12.5, color: "var(--sx-muted)", marginBottom: 8 }}>
                      This item is not in the totals until its identity is confirmed.
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="sx-btn sm primary"
                        disabled={busy}
                        onClick={() => onIdentity("MATCHED", reason)}
                      >
                        Confirm identity
                      </button>
                      <button
                        type="button"
                        className="sx-btn sm"
                        disabled={busy}
                        onClick={() => onIdentity("UNRELATED", reason)}
                      >
                        Not related
                      </button>
                    </div>
                  </div>
                ) : isImpersonation ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <button
                      type="button"
                      className="sx-btn sm"
                      disabled={busy}
                      onClick={() =>
                        onDecision("REJECT", reason || "Confirmed official", "Confirmed official")
                      }
                    >
                      Confirmed official
                    </button>
                    <button
                      type="button"
                      className="sx-btn sm primary"
                      disabled={busy}
                      onClick={() => onDecision("VERIFY", reason, "Possible impersonation")}
                    >
                      Possible impersonation
                    </button>
                    <button
                      type="button"
                      className="sx-btn sm"
                      disabled={busy}
                      onClick={() => onIdentity("UNRELATED", reason || "Not related")}
                    >
                      Not related
                    </button>
                    <button
                      type="button"
                      className="sx-btn sm"
                      disabled={busy}
                      onClick={() => onDecision("ESCALATE", reason)}
                    >
                      Escalate for verification
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <button
                      type="button"
                      className="sx-btn sm primary"
                      disabled={busy}
                      onClick={() => onDecision("VERIFY", reason)}
                    >
                      Verify
                    </button>
                    <button
                      type="button"
                      className="sx-btn sm"
                      disabled={busy}
                      onClick={() => onDecision("REJECT", reason)}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="sx-btn sm"
                      disabled={busy}
                      onClick={() => onDecision("NEEDS_REVIEW", reason)}
                    >
                      Needs review
                    </button>
                    <button
                      type="button"
                      className="sx-btn sm"
                      disabled={busy}
                      onClick={() => onDecision("ESCALATE", reason)}
                    >
                      Escalate
                    </button>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 18 }}>
                <div className="sx-eyebrow" style={{ marginBottom: 8 }}>
                  Staff history
                </div>
                {(data?.decisions ?? []).length ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {(data?.decisions ?? []).map((x) => (
                      <div key={s(x.id)} style={{ fontSize: 12, color: "var(--sx-ink-2)" }}>
                        <span className="sx-mono" style={{ color: "var(--sx-faint)" }}>
                          {fmtDate(s(x.created_at))} {fmtTime(s(x.created_at))}
                        </span>{" "}
                        {s(x.action).replace(/_/g, " ")}: {s(x.previous_state)} → {s(x.new_state)}
                        {x.actor_id === data?.viewerId ? " (you)" : ""}
                        {x.reason ? ` — ${s(x.reason)}` : ""}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--sx-faint)" }}>
                    No staff decisions yet.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
