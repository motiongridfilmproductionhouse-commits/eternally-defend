import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import InvestigationTerminal from "./InvestigationTerminal";
import InvestigationReportView from "./InvestigationReportView";
import {
  getWebsiteInvestigation,
  runWebsiteInvestigation,
} from "@/lib/investigation.functions";
import {
  normalizeInvestigationResponse,
  pollInvestigationJob,
  resolveInvestigationUrl,
  type WebsiteInvestigationModalState,
  type WebsiteInvestigationResult,
} from "@/lib/investigation/website-investigation";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: unknown;
};

const COMPLETE_TRANSITION_MS = 400;

export default function InvestigationModal({ open, onOpenChange, match }: Props) {
  const runInvestigationFn = useServerFn(runWebsiteInvestigation);
  const getInvestigationFn = useServerFn(getWebsiteInvestigation);

  const [modalState, setModalState] =
    useState<WebsiteInvestigationModalState>("idle");
  const [investigationResult, setInvestigationResult] =
    useState<WebsiteInvestigationResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const resetModal = useCallback(() => {
    runIdRef.current += 1;
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setModalState("idle");
    setInvestigationResult(null);
    setProgress(0);
    setErrorMessage(null);
  }, []);

  const closeModal = useCallback(() => {
    resetModal();
    onOpenChange(false);
  }, [onOpenChange, resetModal]);

  const finishWithResult = useCallback((result: WebsiteInvestigationResult) => {
    setProgress(100);
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => {
      setInvestigationResult(result);
      setModalState("completed");
      console.log("[website-investigation] state changed to completed");
    }, COMPLETE_TRANSITION_MS);
  }, []);

  const startInvestigation = useCallback(async () => {
    const url = resolveInvestigationUrl(match);
    if (!url) {
      setErrorMessage("No valid investigation URL was found for this match.");
      setModalState("failed");
      return;
    }

    const classification =
      typeof (match as { detection_type?: string })?.detection_type === "string"
        ? (match as { detection_type: string }).detection_type
        : null;

    const runId = ++runIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setModalState("investigating");
    setInvestigationResult(null);
    setProgress(0);
    setErrorMessage(null);

    try {
      const response = await runInvestigationFn({
        data: { url, classification: classification ?? undefined },
      });
      if (runId !== runIdRef.current) return;

      console.log("[website-investigation] API response", response);
      let outcome = normalizeInvestigationResponse(response, {
        classification,
        fallbackUrl: url,
      });
      console.log("[website-investigation] normalized result", outcome);

      if (outcome.kind === "job") {
        outcome = await pollInvestigationJob(
          async (jobId) => getInvestigationFn({ data: { jobId } }),
          outcome.jobId,
          { signal: controller.signal },
        );
        console.log("[website-investigation] normalized result", outcome);
      }

      if (outcome.kind === "error") {
        setErrorMessage(outcome.message);
        setModalState("failed");
        return;
      }

      if (outcome.kind === "job") {
        setErrorMessage("Investigation is still running.");
        setModalState("failed");
        return;
      }

      finishWithResult(outcome.result);
    } catch (error) {
      if (runId !== runIdRef.current) return;
      const message =
        error instanceof Error ? error.message : "Investigation failed.";
      setErrorMessage(message);
      setModalState("failed");
    }
  }, [finishWithResult, getInvestigationFn, match, runInvestigationFn]);

  useEffect(() => {
    if (!open) {
      resetModal();
      return;
    }
    void startInvestigation();
    return () => {
      runIdRef.current += 1;
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, match]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="h-[700px] w-[1100px] max-w-[95vw] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-white">Website Investigation</h2>
            <p className="text-sm text-zinc-400">Digital Infrastructure Intelligence</p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="text-white hover:text-red-400"
            aria-label="Close investigation modal"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          {modalState === "investigating" && (
            <InvestigationTerminal active progress={progress} />
          )}

          {modalState === "completed" && investigationResult && (
            <InvestigationReportView result={investigationResult} onClose={closeModal} />
          )}

          {modalState === "failed" && (
            <div className="flex h-[600px] flex-col items-center justify-center rounded-xl border border-red-500/30 bg-zinc-900/50 p-8 text-center text-white">
              <h3 className="text-lg font-semibold text-red-400">Investigation failed</h3>
              <p className="mt-3 max-w-lg text-sm text-zinc-300">
                {errorMessage ?? "The investigation could not be completed."}
              </p>
              <div className="mt-6 flex gap-3">
                <Button onClick={() => void startInvestigation()}>Retry</Button>
                <Button variant="outline" onClick={closeModal}>
                  Close
                </Button>
              </div>
            </div>
          )}

          {modalState === "idle" && (
            <div className="flex h-[600px] items-center justify-center text-zinc-400">
              Preparing investigation…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
