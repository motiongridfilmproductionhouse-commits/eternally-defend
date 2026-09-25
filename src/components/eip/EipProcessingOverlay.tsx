import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Fingerprint, ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EIP_STAGES, isActive, type EipJob } from "@/lib/eip/eip-data";
import { useSignedUrl } from "./EipParts";

const RESULT = {
  PASS: { title: "EIP Protection Validated", icon: ShieldCheck, tone: "is-pass", text: "The protected asset and its certificate record are ready." },
  LIMITED: { title: "EIP Protection Limited", icon: ShieldAlert, tone: "is-limited", text: "Protection was applied, but some evaluations reported limited performance." },
  FAIL: { title: "Image Did Not Meet EIP Protection Requirements", icon: ShieldX, tone: "is-fail", text: "Review the reasons in the result details before trying another image." },
  SYSTEM_ERROR: { title: "EIP Processing Could Not Complete", icon: AlertTriangle, tone: "is-error", text: "This was an operational issue, not a judgement on your image." },
} as const;

const STAGE_COPY: Record<string, string> = {
  "Validating Image": "Confirming the image is suitable for protection…",
  "Analyzing Identity": "Analysing identity-relevant signals…",
  "Applying EIP Protection": "Preparing the protected image layer…",
  "Testing Visual Quality": "Validating visual quality of the protected asset…",
  "Testing Transformation Robustness": "Testing resilience to common transformations…",
  "Evaluating Protection": "Evaluating identity-protection performance…",
  "Generating Certificate": "Generating a protected asset and certificate record…",
};

function BinaryField() {
  const cols = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        left: `${(i / 22) * 100 + Math.random() * 3}%`,
        dur: `${18 + Math.random() * 22}s`,
        delay: `-${Math.random() * 30}s`,
        depth: i % 3,
        text: Array.from({ length: 40 }, () => (Math.random() > 0.5 ? "1" : "0")).join("\n"),
      })),
    [],
  );
  return (
    <div className="eip-proc-binary" aria-hidden>
      {cols.map((c, i) => (
        <span
          key={i}
          className={`eip-proc-col d${c.depth}`}
          style={{ left: c.left, animationDuration: c.dur, animationDelay: c.delay }}
        >
          {c.text}
        </span>
      ))}
      <div className="eip-proc-grid" />
    </div>
  );
}

export function EipProcessingOverlay({
  job,
  file,
  onClose,
  onViewResult,
}: {
  job: EipJob;
  file: File | null;
  onClose: () => void;
  onViewResult: () => void;
}) {
  const [localSrc, setSrc] = useState<string | null>(null);
  const signed = useSignedUrl(file ? null : job.storage_path);
  const src = localSrc ?? signed;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const done = job.status in RESULT ? RESULT[job.status as keyof typeof RESULT] : null;
  const queued = job.status === "QUEUED";
  const stageIdx = job.current_stage ? EIP_STAGES.indexOf(job.current_stage as (typeof EIP_STAGES)[number]) : -1;
  const activeStage = stageIdx >= 0 ? EIP_STAGES[stageIdx] : null;

  if (!mounted) return null;
  const DoneIcon = done?.icon;

  return createPortal(
    <div className="eip-proc-root" role="dialog" aria-modal="true" aria-labelledby="eip-proc-title">
      <div className="eip-proc-backdrop" />
      <BinaryField />
      <div className={`eip-proc-card ${done ? `is-done ${done.tone}` : ""}`}>
        <button className="eip-proc-close" onClick={onClose} aria-label="Continue in background">
          <X className="size-4" />
        </button>
        <header className="eip-proc-head">
          <span className="eip-proc-emblem">
            {DoneIcon ? <DoneIcon className="size-4" /> : <Fingerprint className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="eip-proc-eyebrow">Eterna Image Immunization</p>
            <h2 id="eip-proc-title" className="eip-proc-title">
              {done ? done.title : "Protecting your image"}
            </h2>
          </div>
        </header>

        <div className="eip-proc-stage-wrap">
          <div className="eip-proc-image">
            {src ? <img src={src} alt="" /> : <div className="eip-proc-image-empty" />}
            {!done && (
              <>
                <span className="eip-proc-pixels" />
                <span className="eip-proc-beam" />
                <span className="eip-proc-ring r1" />
                <span className="eip-proc-ring r2" />
                <span className="eip-proc-ring r3" />
              </>
            )}
            <span className="eip-proc-field" />
            <span className="eip-proc-chip">
              <span className="eip-proc-chip-dot" />
              {done ? job.status.replace("_", " ") : activeStage ?? (queued ? "Queued for EIP engine" : "Processing")}
            </span>
          </div>
        </div>

        {done ? (
          <div className="eip-proc-result">
            <p>{done.text}</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={onViewResult}>View result</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="eip-proc-progress" aria-hidden>
              <span />
            </div>
            <p className="eip-proc-sub">
              {activeStage
                ? STAGE_COPY[activeStage]
                : queued
                  ? "Your image is stored privately and waiting for the EIP engine to pick it up."
                  : "Applying EIP protection and validating the asset before release."}
            </p>
            <ol className="eip-proc-stages">
              {EIP_STAGES.map((s, i) => {
                const state = i < stageIdx ? "done" : i === stageIdx ? "active" : "todo";
                return (
                  <li key={s} className={`is-${state}`}>
                    <span className="eip-proc-dot">{state === "done" ? <Check className="size-3" /> : i + 1}</span>
                    {s}
                  </li>
                );
              })}
            </ol>
            <footer className="eip-proc-foot">
              {isActive(job.status) || queued
                ? "Stages update from the EIP engine. You can close this — processing continues in the background."
                : ""}
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
