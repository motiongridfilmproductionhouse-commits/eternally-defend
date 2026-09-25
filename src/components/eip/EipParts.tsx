import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ServerCrash, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EIP_STAGES,
  STATUS_LABEL,
  STATUS_STYLE,
  eipDb,
  isActive,
  reasonLabel,
  type EipEvaluation,
  type EipJob,
  type EipStatus,
} from "@/lib/eip/eip-data";

export function EipStatusBadge({ status }: { status: EipStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function useSignedUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return setUrl(null);
    let off = false;
    eipDb.storage
      .from("eip-uploads")
      .createSignedUrl(path, 600)
      .then(({ data }) => !off && setUrl(data?.signedUrl ?? null));
    return () => {
      off = true;
    };
  }, [path]);
  return url;
}

export function Thumb({ path, className = "size-12" }: { path: string | null; className?: string }) {
  const url = useSignedUrl(path);
  return url ? (
    <img src={url} alt="" className={`${className} rounded-md object-cover border border-border`} />
  ) : (
    <div className={`${className} rounded-md bg-muted border border-border`} />
  );
}

/** Stage progression — shows only the stage the backend reports, no invented percentages. */
export function StageProgress({ job }: { job: EipJob }) {
  const idx = job.current_stage ? EIP_STAGES.indexOf(job.current_stage as never) : -1;
  return (
    <div className="space-y-3">
      {job.status === "QUEUED" && (
        <p className="text-sm text-muted-foreground">
          Queued — waiting for the EIP engine to pick up this job. Stages update as the engine reports
          them.
        </p>
      )}
      <ol className="space-y-2">
        {EIP_STAGES.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              {done ? (
                <CheckCircle2 className="size-4 text-success shrink-0" />
              ) : active ? (
                <Loader2 className="size-4 text-primary animate-spin shrink-0" />
              ) : (
                <Circle className="size-4 text-muted-foreground/50 shrink-0" />
              )}
              <span className={active ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground"}>
                {s}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const OUTCOME = {
  PASS: { icon: CheckCircle2, cls: "text-success", title: "EIP Protection Validated" },
  LIMITED: { icon: AlertTriangle, cls: "text-warning", title: "EIP Protection Limited" },
  FAIL: { icon: XCircle, cls: "text-danger", title: "Image Did Not Meet EIP Protection Requirements" },
  SYSTEM_ERROR: { icon: ServerCrash, cls: "text-muted-foreground", title: "EIP Processing Could Not Complete" },
} as const;

export function JobResult({
  job,
  evaluations,
  onReevaluate,
  onRetry,
  onNew,
}: {
  job: EipJob;
  evaluations: EipEvaluation[];
  onReevaluate?: () => void;
  onRetry?: () => void;
  onNew?: () => void;
}) {
  const [showCert, setShowCert] = useState(false);
  const protectedUrl = useSignedUrl(job.protected_storage_path);
  if (isActive(job.status)) return <StageProgress job={job} />;
  if (job.status === "CANCELLED") return <p className="text-sm text-muted-foreground">Processing was cancelled.</p>;
  const o = OUTCOME[job.status];
  const initial = evaluations.find((e) => e.is_initial) ?? evaluations[0];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <o.icon className={`size-6 shrink-0 ${o.cls}`} />
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold text-foreground">{o.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {job.status === "PASS" && "The protected image met all current EIP validation criteria."}
            {job.status === "LIMITED" &&
              "The image showed measurable protection but did not meet all full PASS criteria."}
            {job.status === "FAIL" && "The image did not meet the EIP protection requirements."}
            {job.status === "SYSTEM_ERROR" &&
              `${job.error_message ?? "EIP processing could not complete."} This is an operational failure, not a protection result.`}
          </p>
        </div>
      </div>

      {job.reason_codes.length > 0 && (
        <ul className="text-sm list-disc pl-5 space-y-1 text-foreground">
          {job.reason_codes.map((c) => (
            <li key={c}>{reasonLabel(c)}</li>
          ))}
        </ul>
      )}

      {(job.status === "PASS" || job.status === "LIMITED") && (
        <div className="grid sm:grid-cols-[160px_minmax(0,1fr)] gap-4">
          <Thumb path={job.protected_storage_path} className="w-40 h-40" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Meta k="EIP version" v={job.engine_version} />
            <Meta k="Date" v={job.completed_at && new Date(job.completed_at).toLocaleString()} />
            <Meta k="Visual quality" v={initial?.visual_quality} />
            <Meta k="Transformation robustness" v={initial?.transformation_robustness} />
            <Meta k="Identity evaluation" v={initial?.identity_evaluation} />
          </dl>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {job.status === "PASS" && (
          <>
            <Button asChild disabled={!protectedUrl}>
              <a href={protectedUrl ?? "#"} download>
                Download Protected Image
              </a>
            </Button>
            <Button variant="outline" onClick={() => setShowCert((v) => !v)}>
              View Certificate
            </Button>
          </>
        )}
        {job.status === "LIMITED" && (
          <Button variant="outline" onClick={() => setShowCert((v) => !v)}>
            View Technical Report
          </Button>
        )}
        {(job.status === "PASS" || job.status === "LIMITED" || job.status === "FAIL") && onReevaluate && (
          <Button variant="outline" onClick={onReevaluate}>
            Re-evaluate
          </Button>
        )}
        {job.status === "FAIL" && onNew && <Button onClick={onNew}>Try Another Image</Button>}
        {job.status === "SYSTEM_ERROR" && (
          <>
            {onRetry && <Button onClick={onRetry}>Retry</Button>}
            <Button variant="outline" asChild>
              <a href="/contact">Contact Support</a>
            </Button>
          </>
        )}
      </div>

      {showCert && <Certificate job={job} evaluation={initial} />}
      <History evaluations={evaluations} />
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-foreground break-words">{v || "—"}</dd>
    </>
  );
}

export function Certificate({ job, evaluation }: { job: EipJob; evaluation?: EipEvaluation }) {
  const text = [
    ["EIP certificate ID", job.certificate_id],
    ["Job ID", job.id],
    ["Authorization ID", job.authorization_ref],
    ["Original asset hash", job.original_sha256],
    ["Protected asset hash", job.protected_sha256],
    ["EIP engine version", job.engine_version],
    ["Configuration SHA-256", job.config_sha256],
    ["Evaluation version", evaluation?.evaluation_version],
    ["Issued", job.completed_at],
    ["Evaluation status", evaluation?.status ?? job.status],
  ] as const;
  const download = () => {
    const body = text.map(([k, v]) => `${k}: ${v ?? "—"}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    a.download = `eip-certificate-${job.certificate_id ?? job.id}.txt`;
    a.click();
  };
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-[10px] tracking-[0.2em] font-semibold text-muted-foreground uppercase mb-3">
        EIP Certificate
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {text.map(([k, v]) => (
          <Meta key={k} k={k} v={v} />
        ))}
      </dl>
      {job.certificate_id && (
        <Button variant="outline" size="sm" className="mt-4" onClick={download}>
          Download Certificate
        </Button>
      )}
    </div>
  );
}

function History({ evaluations }: { evaluations: EipEvaluation[] }) {
  if (evaluations.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] font-semibold text-muted-foreground uppercase mb-2">
        Evaluation history
      </div>
      <ul className="space-y-1.5 text-sm">
        {evaluations.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <span className="text-foreground">
              {e.is_initial ? "Initial Evaluation" : `Evaluation ${e.evaluation_version}`}
            </span>
            <EipStatusBadge status={e.status} />
            <span className="text-muted-foreground text-xs">{new Date(e.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
