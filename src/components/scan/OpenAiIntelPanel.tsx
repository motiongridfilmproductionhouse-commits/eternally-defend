/**
 * OpenAI Research & Reasoning diagnostics (admin view).
 * Renders the additive AI-layer counters; shows an explicit unavailable state
 * when the layer was skipped, disabled, or failed.
 */

import type { ScanAiDiagnostics } from "@/lib/scan/openai/types";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function StatusChip({ label, status }: { label: string; status: string }) {
  const ok = status === "OK";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
        ok
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      {label}: {status}
    </span>
  );
}

export function OpenAiIntelPanel({ ai }: { ai?: ScanAiDiagnostics | null }) {
  if (!ai) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-card/60 px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          OpenAI Research &amp; Reasoning
        </span>
        <StatusChip label="Research" status={ai.research_status} />
        <StatusChip label="Reasoning" status={ai.reasoning_status} />
        {ai.model && <span className="text-[10px] text-muted-foreground">{ai.model}</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Coverage" value={ai.coverage_assessment} />
        <Stat label="Missing narratives" value={ai.missing_narratives} />
        <Stat label="Base queries passed" value={ai.base_queries_passed} />
        <Stat label="AI queries generated" value={ai.ai_queries_generated} />
        <Stat label="Deduplicated" value={ai.ai_queries_deduplicated} />
        <Stat label="Executed" value={ai.ai_queries_executed} />
        <Stat label="Failed" value={ai.ai_queries_failed} />
        <Stat label="URLs discovered" value={ai.ai_urls_discovered} />
        <Stat label="New unique URLs" value={ai.ai_new_unique_urls} />
        <Stat label="New domains" value={ai.ai_new_domains} />
        <Stat label="New narratives" value={ai.ai_new_narratives} />
        <Stat label="Incremental recall" value={`${ai.ai_incremental_recall_percent}%`} />
        <Stat label="AI verified findings" value={ai.ai_new_verified_findings} />
        <Stat label="AI needs review" value={ai.ai_new_needs_review} />
        <Stat label="Calls / new URL" value={ai.cost_per_new_unique_url} />
        <Stat label="Evidence analyzed" value={ai.evidence_analyzed} />
        <Stat label="High risk" value={ai.high_risk} />
        <Stat label="Medium risk" value={ai.medium_risk} />
        <Stat label="Needs review" value={ai.needs_review} />
        <Stat label="Cache hits" value={ai.cache_hits} />
        <Stat label="AI failures" value={ai.ai_failures} />
      </div>

      {(ai.ai_passes ?? []).length > 0 && (
        <div className="mt-3 space-y-2">
          {(ai.ai_passes ?? []).map((p) => (
            <div key={p.pass} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Pass {p.pass}</span>
                <span>{p.status}</span>
                {p.skip_reason && <span className="normal-case font-normal">{p.skip_reason}</span>}
                <span className="ml-auto font-normal">{p.latency_ms} ms</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                generated {p.queries_generated} · deduped {p.queries_deduplicated} · executed{" "}
                {p.queries_executed} · failed {p.queries_failed} · new URLs {p.new_unique_urls} ·
                new domains {p.new_domains} · new narratives {p.new_narratives}
              </div>
              {p.queries.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                  {p.queries.map((q, i) => (
                    <li key={i} className="truncate">
                      <span className="font-semibold text-foreground">{q.query}</span> ·{" "}
                      {q.priority} · {q.language} · {q.source_target} · gain{" "}
                      {q.expected_information_gain} · +{q.new_urls} URLs
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}


      {ai.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
          {ai.notes.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
