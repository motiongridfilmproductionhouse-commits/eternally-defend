import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getProspectScan } from "@/lib/prospect/scan.functions";
import { coverageWord } from "@/lib/prospect/coverage";
import {
  FINDING_STATE_LABEL,
  IDENTITY_LABEL,
  RAIL,
  bandLabel,
  fmtDate,
  hostOf,
  joinFindings,
} from "@/components/staff/staff-model";

export const Route = createFileRoute("/staff/report/$scanId")({
  head: () => ({
    meta: [
      { title: "Pre-Enrollment Report — Eterna" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { scanId } = Route.useParams();
  const scanFn = useServerFn(getProspectScan);
  const q = useQuery({
    queryKey: ["prospect-report", scanId],
    queryFn: () => scanFn({ data: { scanId } }),
  });
  if (q.isLoading)
    return (
      <div style={{ padding: 40, color: "var(--sx-muted)" }}>Loading stored scan records…</div>
    );
  if (q.isError || !q.data) return <div style={{ padding: 40 }}>Could not load this scan.</div>;
  const s = q.data;
  const a = s.analysis;
  const findings = joinFindings(s).filter(
    (f) =>
      f.discovery?.identity_bucket === "MATCHED" &&
      f.state !== "REJECTED" &&
      (f.stage_key !== "search_reputation" || f.category === "Potential risk result"),
  );
  const verified = findings.filter((f) => f.state === "VERIFIED" || f.state === "ESCALATED");
  const awaiting = findings.filter((f) => !["VERIFIED", "ESCALATED"].includes(f.state));
  const cov = a.coverage;
  const stageName = (k: string) => RAIL.find((r) => r.key === k)?.long ?? k;

  return (
    <div
      style={{
        background: "#fff",
        color: "#0b1324",
        minHeight: "100vh",
        padding: "32px clamp(16px,4vw,56px)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <style>{`@media print { .no-print { display:none } } .rp h2{font:600 18px/1.3 var(--font-display);margin:28px 0 10px} .rp table{width:100%;border-collapse:collapse;font-size:12.5px} .rp td,.rp th{border-bottom:1px solid #e5e8ef;padding:7px 8px;text-align:left;vertical-align:top} .rp th{font:500 10px/1 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:#6b7489}`}</style>
      <div className="rp" style={{ maxWidth: 960, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                font: "500 10.5px/1 var(--font-mono)",
                letterSpacing: ".14em",
                color: "#6b7489",
              }}
            >
              ETERNA · PRE-ENROLLMENT INTELLIGENCE REPORT · CONFIDENTIAL
            </div>
            <h1
              style={{
                font: "600 32px/1.1 var(--font-display)",
                letterSpacing: "-.03em",
                margin: "10px 0 4px",
              }}
            >
              {String(s.identity?.display_name ?? "")}
            </h1>
            <div style={{ color: "#5a6478", fontSize: 13 }}>
              Scan {String(s.scan.id)} · started{" "}
              {fmtDate(String(s.scan.started_at ?? s.scan.created_at))} · status{" "}
              {String(s.scan.status)}
            </div>
          </div>
          <button
            type="button"
            className="no-print"
            onClick={() => window.print()}
            style={{
              border: "1px solid #d7dce6",
              borderRadius: 10,
              padding: "8px 14px",
              fontSize: 13,
            }}
          >
            Print / Save as PDF
          </button>
        </div>

        <p
          style={{
            fontSize: 12.5,
            color: "#5a6478",
            lineHeight: 1.6,
            marginTop: 16,
            padding: 12,
            background: "#f5f7fb",
            borderRadius: 10,
          }}
        >
          Prospect intelligence gathered from public sources before enrollment. Every item below is
          a stored, retrieved record. Discovered and classified items are not findings of fact; only
          items marked “Human verified” were reviewed by Eterna staff. No enforcement action is
          taken from a pre-enrollment scan.
        </p>

        <h2>Assessment</h2>
        <table>
          <tbody>
            <tr>
              <th>Preliminary Exposure Signal</th>
              <td>
                <b>{bandLabel(s.scores.preliminary?.band)}</b> — Preliminary · Not yet human
                verified. {s.scores.preliminary?.factors?.qualifier}
              </td>
            </tr>
            <tr>
              <th>Verified Risk Assessment</th>
              <td>
                <b>{bandLabel(s.scores.verified?.band)}</b> —{" "}
                {s.scores.verified?.factors?.qualifier}
              </td>
            </tr>
            <tr>
              <th>Coverage</th>
              <td>
                {coverageWord(cov.state)} — {cov.queriedOk}/{cov.intended + cov.policyDisabled}{" "}
                source families queried
                {cov.qualified ? " · Risk assessment based on available sources" : ""}
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Why these assessments</h2>
        <table>
          <thead>
            <tr>
              <th>Assessment</th>
              <th>Factor</th>
              <th>Detail</th>
              <th>Contribution</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Preliminary", s.scores.preliminary],
              ["Verified", s.scores.verified],
            ].flatMap(([label, sc]) =>
              ((sc as typeof s.scores.preliminary)?.factors?.factors ?? [])
                .filter((f) => f.contribution > 0)
                .map((f) => (
                  <tr key={`${label}-${f.key}`}>
                    <td>{label as string}</td>
                    <td>{f.label}</td>
                    <td>{f.detail}</td>
                    <td>+{f.contribution}</td>
                  </tr>
                )),
            )}
          </tbody>
        </table>

        <h2>Category totals (identity-matched, stored records)</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Relevant</th>
              <th>Awaiting verification</th>
              <th>Human verified</th>
              <th>Analysis</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(a.stages).map((st) => (
              <tr key={st.stage}>
                <td>{stageName(st.stage)}</td>
                <td>
                  {st.capability?.status === "unavailable" && st.stage === "ai_manipulation"
                    ? "—"
                    : st.relevant}
                </td>
                <td>{st.awaitingVerification}</td>
                <td>{st.verified}</td>
                <td>
                  {st.capability ? `${st.capability.status} · ${st.capability.reason ?? ""}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {[
          ["Human-verified findings", verified],
          ["Awaiting human verification", awaiting],
        ].map(([title, list]) => (
          <div key={title as string}>
            <h2>
              {title as string} ({(list as typeof findings).length})
            </h2>
            {(list as typeof findings).length ? (
              <table>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Category</th>
                    <th>Source</th>
                    <th>Identity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(list as typeof findings).map((f) => (
                    <tr key={f.id}>
                      <td>{stageName(f.stage_key)}</td>
                      <td>
                        {f.category}
                        <div style={{ color: "#6b7489", fontSize: 11.5 }}>{f.detection_reason}</div>
                      </td>
                      <td style={{ wordBreak: "break-all" }}>
                        {hostOf(f.discovery?.original_url)}
                        <div style={{ color: "#6b7489", fontSize: 11 }}>
                          {f.discovery?.original_url}
                        </div>
                      </td>
                      <td>
                        {f.discovery
                          ? `${IDENTITY_LABEL[f.discovery.identity_bucket]} · ${f.discovery.identity_confidence}%`
                          : "—"}
                      </td>
                      <td>{FINDING_STATE_LABEL[f.state]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ fontSize: 13, color: "#5a6478" }}>None.</p>
            )}
          </div>
        ))}

        <h2>Sources</h2>
        <table>
          <tbody>
            {s.sources.map((src) => (
              <tr key={src.family_key}>
                <td>{src.family_label}</td>
                <td>{src.state.replace(/_/g, " ")}</td>
                <td>{(src.providers ?? []).join(" · ")}</td>
                <td>{src.failure_reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Provenance</h2>
        <p style={{ fontSize: 12, color: "#5a6478", lineHeight: 1.6 }}>
          Source family set {String(s.scan.source_family_set_version)} · classification{" "}
          {String(s.scan.classification_version)} · scores {s.scores.preliminary?.model_version} /{" "}
          {s.scores.verified?.model_version} · queries:{" "}
          {((s.scan.query_terms as string[]) ?? []).join(" · ")}
        </p>
      </div>
    </div>
  );
}
