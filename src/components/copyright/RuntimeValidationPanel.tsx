import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, Eye, Film, Image as ImageIcon, AlertTriangle } from "lucide-react";

export interface CandidateTraceItem {
  candidateId: string;
  realUrl: string;
  provider: string;
  discoveryQuery?: string;
  discoveryMethod?: string;
  originScanId?: string;
  originAssetId?: string;
  actualTitle: string;
  actualThumbnailUrl?: string;
  actualPosterUrl?: string;
  actualVideoId?: string;
  metadataFetchStatus: "success" | "failed" | "pending";
  visualFetchStatus: "success" | "failed" | "unavailable";
  referenceImageIdUsed?: string;
  referenceFrameIdUsed?: string;
  titleSimilarity: number;
  posterSimilarity: number;
  frameSimilarity: number;
  faceSimilarity: number;
  visualConflict: boolean;
  targetIdentityScore: number;
  targetStatus: "VERIFIED_TARGET" | "PROBABLE_TARGET" | "REVIEW_REQUIRED" | "NOT_SUBJECT";
  piracyRiskScore: number;
  finalFindingDecision: string;
  decisionMethod: "FRAME_MATCH" | "SECONDARY_VISUAL_VERIFICATION" | "PHASH_ONLY" | "METADATA_PLUS_VISUAL" | "FACE_SUPPORTING_SIGNAL" | "METADATA_ONLY";
  executionStatus: "VISUAL_COMPARISON_EXECUTED" | "VISUAL_REFERENCE_UNAVAILABLE" | "CANDIDATE_VISUAL_UNAVAILABLE" | "VISUAL_FETCH_FAILED";
}

export interface RuntimeVerificationDiagnosticsData {
  assetId: string;
  scanId: string;
  scanStatus: string;
  referenceImageCount: number;
  referenceFrameCount: number;
  faceReferenceCount: number;
  candidatesDiscovered: number;
  candidatesFetched: number;
  candidateVisualsExtracted: number;
  candidatesVisuallyCompared: number;
  verifiedTargetsCount: number;
  probableTargetsCount: number;
  reviewRequiredCount: number;
  notSubjectCount: number;
  visualReferenceUnavailableCount: number;
  visualFetchFailedCount: number;
  crossAssetRejectedCount: number;
  historicalRevalidatedCount: number;
  candidateTraces: CandidateTraceItem[];
}

export function RuntimeValidationPanel({
  data,
  isAdmin,
}: {
  data: RuntimeVerificationDiagnosticsData | null | undefined;
  isAdmin: boolean;
}) {
  const [expandedCandidates, setExpandedCandidates] = useState<Record<string, boolean>>({});

  if (!isAdmin) return null;

  if (!data) {
    return (
      <div className="p-6 my-4 border border-amber-500/30 rounded-lg bg-amber-950/20 text-amber-200">
        <div className="flex items-center gap-2 font-semibold text-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          RUNTIME REFERENCE VALIDATION (Admin Diagnostic)
        </div>
        <p className="mt-2 text-sm text-amber-300/80">
          No runtime reference verification diagnostics recorded for this scan yet. Run a scan with reference identity materials enabled.
        </p>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedCandidates((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const hasNoVisualReferences = data.referenceImageCount === 0 && data.referenceFrameCount === 0;

  return (
    <div className="p-6 my-6 border border-primary/40 rounded-xl bg-slate-950/90 text-slate-100 shadow-2xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/20 text-primary border-primary/50 text-xs px-2.5 py-0.5">
              ADMIN DIAGNOSTICS ONLY
            </Badge>
            <h3 className="text-xl font-bold text-slate-100">RUNTIME REFERENCE VALIDATION</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Asset ID: <code className="text-primary font-mono">{data.assetId}</code> | Scan ID:{" "}
            <code className="text-slate-300 font-mono">{data.scanId}</code> | Status:{" "}
            <span className="capitalize font-semibold text-emerald-400">{data.scanStatus}</span>
          </p>
        </div>
        {hasNoVisualReferences && (
          <Badge className="bg-amber-500/20 border-amber-500/60 text-amber-300 text-xs px-3 py-1">
            Visual reference verification unavailable for this asset.
          </Badge>
        )}
      </div>

      {/* Reference Asset Summary Counters Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-lg">
          <div className="text-xs text-slate-400">Posters / Stills</div>
          <div className="text-2xl font-bold text-slate-100 mt-1">{data.referenceImageCount}</div>
        </div>
        <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-lg">
          <div className="text-xs text-slate-400">Reference Keyframes</div>
          <div className="text-2xl font-bold text-slate-100 mt-1">{data.referenceFrameCount}</div>
        </div>
        <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-lg">
          <div className="text-xs text-slate-400">Cast Face References</div>
          <div className="text-2xl font-bold text-slate-100 mt-1">{data.faceReferenceCount}</div>
        </div>
        <div className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-lg">
          <div className="text-xs text-slate-400">Candidates Visually Compared</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{data.candidatesVisuallyCompared}</div>
        </div>
      </div>

      {/* Pipeline Status Breakdown Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-md">
          <div className="text-emerald-400 font-semibold">VERIFIED_TARGET</div>
          <div className="text-xl font-bold text-emerald-200 mt-1">{data.verifiedTargetsCount}</div>
        </div>
        <div className="p-3 bg-blue-950/30 border border-blue-500/30 rounded-md">
          <div className="text-blue-400 font-semibold">PROBABLE_TARGET</div>
          <div className="text-xl font-bold text-blue-200 mt-1">{data.probableTargetsCount}</div>
        </div>
        <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-md">
          <div className="text-amber-400 font-semibold">REVIEW_REQUIRED</div>
          <div className="text-xl font-bold text-amber-200 mt-1">{data.reviewRequiredCount}</div>
        </div>
        <div className="p-3 bg-red-950/30 border border-red-500/30 rounded-md">
          <div className="text-red-400 font-semibold">NOT_SUBJECT</div>
          <div className="text-xl font-bold text-red-200 mt-1">{data.notSubjectCount}</div>
        </div>
      </div>

      {/* Candidate Validation Traces */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Discovered Candidate Verification Traces ({data.candidateTraces.length})
        </h4>

        {data.candidateTraces.length === 0 ? (
          <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg text-slate-400 text-xs italic text-center">
            No individual candidate traces recorded for this scan run.
          </div>
        ) : (
          data.candidateTraces.map((item) => {
            const isExpanded = expandedCandidates[item.candidateId];
            return (
              <div
                key={item.candidateId}
                className="border border-slate-800 rounded-lg bg-slate-900/60 overflow-hidden text-xs"
              >
                {/* Header Row */}
                <div
                  className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-slate-800/40 transition-colors"
                  onClick={() => toggleExpand(item.candidateId)}
                >
                  <div className="space-y-1 max-w-xl">
                    <div className="font-semibold text-sm text-slate-100 line-clamp-1">{item.actualTitle}</div>
                    <div className="text-slate-400 font-mono truncate max-w-md">{item.realUrl}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        item.targetStatus === "VERIFIED_TARGET"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : item.targetStatus === "PROBABLE_TARGET"
                          ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                          : item.targetStatus === "REVIEW_REQUIRED"
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : "bg-red-500/20 text-red-300 border-red-500/40"
                      }
                    >
                      {item.targetStatus} ({item.targetIdentityScore}%)
                    </Badge>
                    <Badge className="bg-slate-800 text-slate-300 border-slate-700">
                      Method: {item.decisionMethod}
                    </Badge>
                    <Badge className="bg-slate-800 text-slate-300 border-slate-700">
                      {item.executionStatus}
                    </Badge>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {/* Expanded Details Pane */}
                {isExpanded && (
                  <div className="p-4 border-t border-slate-800 bg-slate-950/80 space-y-4 text-slate-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-[11px]">
                      <div className="space-y-1 bg-slate-900/90 p-3 rounded border border-slate-800">
                        <div>Candidate ID: <span className="text-slate-100">{item.candidateId}</span></div>
                        <div>Provider: <span className="text-slate-100">{item.provider}</span></div>
                        <div>Discovery Query: <span className="text-slate-100">{item.discoveryQuery || "N/A"}</span></div>
                        <div>Video ID: <span className="text-slate-100">{item.actualVideoId || "N/A"}</span></div>
                        <div>Metadata Fetch: <span className="text-emerald-400 capitalize">{item.metadataFetchStatus}</span></div>
                        <div>Visual Fetch: <span className="text-blue-400 capitalize">{item.visualFetchStatus}</span></div>
                      </div>

                      <div className="space-y-1 bg-slate-900/90 p-3 rounded border border-slate-800">
                        <div>Title Similarity: <span className="text-slate-100">{item.titleSimilarity}%</span></div>
                        <div>Poster Similarity: <span className="text-slate-100">{item.posterSimilarity}%</span></div>
                        <div>Frame Similarity: <span className="text-slate-100">{item.frameSimilarity}%</span></div>
                        <div>Cast Face Similarity: <span className="text-slate-100">{item.faceSimilarity}%</span></div>
                        <div>Visual Conflict: <span className={item.visualConflict ? "text-red-400 font-bold" : "text-emerald-400"}>{String(item.visualConflict)}</span></div>
                        <div>Piracy Risk Score: <span className="text-amber-300 font-bold">{item.piracyRiskScore}%</span></div>
                      </div>
                    </div>

                    {/* Side-by-side Visual Comparison View */}
                    {item.actualThumbnailUrl && (
                      <div className="p-3 bg-slate-900/90 rounded border border-slate-800 space-y-2">
                        <div className="font-semibold text-slate-200 text-xs">VISUAL COMPARISON PREVIEW</div>
                        <div className="flex flex-wrap items-center gap-6">
                          <div className="space-y-1">
                            <div className="text-[10px] text-slate-400">EXTRACTED CANDIDATE IMAGE</div>
                            <img
                              src={item.actualThumbnailUrl}
                              alt="Candidate"
                              className="h-24 w-36 object-cover rounded border border-slate-700 bg-black"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="text-[10px] text-slate-400">SIMILARITY EVALUATION</div>
                            <div className="text-xl font-bold text-primary">
                              Poster: {item.posterSimilarity}% | Frame: {item.frameSimilarity}%
                            </div>
                            <div className="text-[10px] text-slate-400">Decision: {item.finalFindingDecision}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
