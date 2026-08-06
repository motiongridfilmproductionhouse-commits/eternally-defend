import { useEffect, useMemo, useState } from "react";
import { RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IdentityScanVisualization } from "@/components/deepfake/IdentityScanVisualization";
import {
  sarayuDemoProgressAt,
  SARAYU_DEMO_DURATION_MS,
  type SarayuDemoProgress,
  type SarayuDemoStage,
} from "@/lib/deepfake/sarayu-demo-animation";

const STAGES: Array<{ id: SarayuDemoStage; title: string; copy: string }> = [
  { id: "identity", title: "Identity Lock", copy: "Loading protected identity profile" },
  { id: "embeddings", title: "Face Reference", copy: "Preparing identity embeddings" },
  { id: "discovery", title: "Web Discovery", copy: "Searching public sources" },
  { id: "analysis", title: "Media Analysis", copy: "Analyzing candidate pages and media" },
  { id: "verification", title: "URL Verification", copy: "Validating evidence URLs" },
  { id: "classification", title: "Evidence Classification", copy: "Classifying verified threats" },
];

export type SarayuDemoSequence = {
  active: boolean;
  complete: boolean;
  progress: SarayuDemoProgress;
  skip: () => void;
  replay: () => void;
};

function wasCompleted(key: string | null): boolean {
  if (!key || typeof window === "undefined") return false;
  return window.sessionStorage.getItem(key) === "complete";
}

export function useSarayuDemoSequence(key: string | null, enabled: boolean): SarayuDemoSequence {
  const initiallyComplete = enabled && wasCompleted(key);
  const [active, setActive] = useState(enabled && !initiallyComplete);
  const [complete, setComplete] = useState(initiallyComplete);
  const [elapsedMs, setElapsedMs] = useState(initiallyComplete ? SARAYU_DEMO_DURATION_MS : 0);
  const [replayNonce, setReplayNonce] = useState(0);

  useEffect(() => {
    const alreadyComplete = enabled && wasCompleted(key);
    setActive(enabled && !alreadyComplete);
    setComplete(alreadyComplete);
    setElapsedMs(alreadyComplete ? SARAYU_DEMO_DURATION_MS : 0);
    if (!enabled || alreadyComplete || !key) return;

    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const nextElapsed = performance.now() - startedAt;
      if (nextElapsed >= SARAYU_DEMO_DURATION_MS) {
        window.sessionStorage.setItem(key, "complete");
        setElapsedMs(SARAYU_DEMO_DURATION_MS);
        setActive(false);
        setComplete(true);
        window.clearInterval(timer);
        return;
      }
      setElapsedMs(nextElapsed);
    }, 100);
    return () => window.clearInterval(timer);
  }, [enabled, key, replayNonce]);

  const skip = () => {
    if (key && typeof window !== "undefined") window.sessionStorage.setItem(key, "complete");
    setElapsedMs(SARAYU_DEMO_DURATION_MS);
    setActive(false);
    setComplete(true);
  };

  const replay = () => {
    if (key && typeof window !== "undefined") window.sessionStorage.removeItem(key);
    setElapsedMs(0);
    setComplete(false);
    setActive(Boolean(enabled && key));
    setReplayNonce((value) => value + 1);
  };

  return {
    active,
    complete,
    progress: useMemo(() => sarayuDemoProgressAt(elapsedMs), [elapsedMs]),
    skip,
    replay,
  };
}

function visualizationStage(stage: SarayuDemoStage): string {
  if (stage === "identity" || stage === "embeddings") return "discovering";
  if (stage === "discovery" || stage === "analysis") return "discovering";
  if (stage === "verification") return "verifying";
  return "classifying";
}

function counterLabel(progress: SarayuDemoProgress): string {
  if (progress.stage === "identity") return "Reference photos: 5/5 · Identity model ready";
  if (progress.stage === "embeddings") return "Reference faces analyzed: 5 · Embeddings prepared";
  if (progress.stage === "discovery")
    return `${progress.queries}/39 queries · ${progress.domains} domains investigated`;
  if (progress.stage === "analysis")
    return `${progress.pages} pages analyzed · ${progress.faceComparisons} face comparisons`;
  if (progress.stage === "verification")
    return `${progress.verifiedPages} verified pages · ${progress.domains} unique domains`;
  return `${progress.highRiskFindings} high-risk findings · Investigation complete`;
}

export function SarayuDemoScanSequence({
  sequence,
  thumbnailUrl,
  enrolledCount,
  scanId,
}: {
  sequence: SarayuDemoSequence;
  thumbnailUrl?: string | null;
  enrolledCount: number;
  scanId: string | null;
}) {
  const { progress } = sequence;
  const currentIndex = STAGES.findIndex((stage) => stage.id === progress.stage);
  return (
    <section className="space-y-3" data-testid="sarayu-demo-sequence">
      <div className="rounded-md border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
        Demonstration scan visualization · staged presentation only; no provider calls are
        represented.
      </div>
      <IdentityScanVisualization
        artistName="Sarayu Mohan"
        enrolledCount={enrolledCount || 5}
        thumbnailUrl={thumbnailUrl}
        scanStatus="running"
        stage={visualizationStage(progress.stage)}
        executedQueries={progress.queries}
        plannedQueries={39}
        pagesVerified={progress.verifiedPages}
        threatsSaved={0}
        threatSummary={null}
        threatFindings={[]}
        scanId={scanId}
        threatFindingsReady={false}
      />
      <div className="card-surface p-4" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Current stage
            </div>
            <div className="mt-1 text-sm font-semibold">
              {progress.stage === "complete"
                ? "Evidence Classification"
                : STAGES[currentIndex]?.title}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {progress.stage === "complete"
                ? "Investigation complete"
                : STAGES[currentIndex]?.copy}
            </div>
          </div>
          <div
            className="flex size-14 items-center justify-center rounded-full border-4 border-sky-400/20 text-sm font-semibold text-sky-300"
            style={{ borderTopColor: "rgb(56 189 248 / 0.9)" }}
          >
            {Math.round(progress.progress * 100)}%
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STAGES.map((stage, index) => (
            <div
              key={stage.id}
              className={`rounded border px-2 py-2 text-[11px] ${index < currentIndex || progress.stage === "complete" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : index === currentIndex ? "border-sky-400/40 bg-sky-500/10 text-sky-200" : "border-border/60 text-muted-foreground"}`}
            >
              {index < currentIndex || progress.stage === "complete"
                ? "Complete · "
                : index === currentIndex
                  ? "Active · "
                  : "Queued · "}
              {stage.title}
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">{counterLabel(progress)}</div>
        {sequence.active ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={sequence.skip}
            data-testid="sarayu-demo-skip"
          >
            <SkipForward className="mr-1.5 size-3.5" /> Skip animation
          </Button>
        ) : sequence.complete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={sequence.replay}
            data-testid="sarayu-demo-replay"
          >
            <RotateCcw className="mr-1.5 size-3.5" /> Replay scan animation
          </Button>
        ) : null}
      </div>
    </section>
  );
}
