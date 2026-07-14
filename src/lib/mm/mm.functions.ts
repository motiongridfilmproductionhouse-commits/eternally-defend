/**
 * Multimedia Intelligence Engine — server functions.
 *
 * Because service-account creation is blocked by GCP org policy, Video
 * Intelligence / Speech-to-Text / Vision run in "stub" mode and their
 * stages are marked "unavailable" — the orchestrator keeps running so
 * Translation, claim extraction, and Fact Check still deliver results.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const StartInput = z.object({
  source_kind: z.enum(["youtube_meta", "upload_video", "upload_audio", "upload_image", "screenshot", "url"]),
  source_ref: z.string().min(1).max(500),
  source_metadata: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    channel: z.string().optional(),
    thumbnail: z.string().optional(),
    transcript: z.string().optional(),
    ocr_text: z.string().optional(),
    duration_seconds: z.number().optional(),
    view_count: z.number().optional(),
    language_code: z.string().optional(),
    video_id: z.string().optional(),
  }).default({}),
  target_name: z.string().min(1).max(200),
  target_aliases: z.array(z.string().max(120)).max(20).default([]),
});
export type StartInput = z.infer<typeof StartInput>;

const STAGES = [
  "prepare",
  "upload",
  "video_intelligence",
  "audio_extract",
  "transcription",
  "mention_detect",
  "vision_frames",
  "translation",
  "claim_extract",
  "fact_check",
  "risk_score",
  "save_evidence",
  "threat_radar",
  "finalize",
] as const;
export type Stage = (typeof STAGES)[number];

export const startMultimediaAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => StartInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const stageInit = Object.fromEntries(STAGES.map((s) => [s, "pending"])) as Record<Stage, string>;

    // Insert or fetch existing job (deduped by user_id + source_kind + source_ref)
    const { data: existing } = await supabase
      .from("multimedia_analysis_jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("source_kind", data.source_kind)
      .eq("source_ref", data.source_ref)
      .maybeSingle();

    let jobId: string;
    if (existing) {
      jobId = existing.id as string;
      await supabase.from("multimedia_analysis_jobs")
        .update({
          status: "running",
          stage_status: stageInit,
          progress_percent: 0,
          progress_message: "Restarting analysis",
          started_at: new Date().toISOString(),
          target_name: data.target_name,
          target_aliases: data.target_aliases,
          source_metadata: data.source_metadata,
        })
        .eq("id", jobId);
      // Clean previous partials
      await supabase.from("timestamp_findings").delete().eq("job_id", jobId);
      await supabase.from("fact_check_matches").delete().eq("job_id", jobId);
      await supabase.from("extracted_claims").delete().eq("job_id", jobId);
      await supabase.from("translations").delete().eq("job_id", jobId);
      await supabase.from("multimedia_errors").delete().eq("job_id", jobId);
    } else {
      const { data: inserted, error } = await supabase.from("multimedia_analysis_jobs").insert({
        user_id: userId,
        source_kind: data.source_kind,
        source_ref: data.source_ref,
        source_metadata: data.source_metadata,
        target_name: data.target_name,
        target_aliases: data.target_aliases,
        status: "running",
        stage_status: stageInit,
        progress_message: "Starting analysis",
        started_at: new Date().toISOString(),
      }).select("id").single();
      if (error || !inserted) throw new Error(error?.message ?? "insert failed");
      jobId = inserted.id as string;
    }

    // Quota + cost pre-check
    const { checkAndReserveQuota, estimateCostCents } = await import("./quota.server");
    const est = estimateCostCents({
      durationSeconds: data.source_metadata?.duration_seconds,
      hasVideoIntel: false, hasStt: false, hasVision: false,
      claimsToCheck: 8,
    });
    const quota = await checkAndReserveQuota(supabase, userId, est);
    if (!quota.allowed) {
      await supabase.from("multimedia_analysis_jobs")
        .update({ status: "failed", canceled_reason: quota.reason, progress_message: quota.reason, finished_at: new Date().toISOString() })
        .eq("id", jobId);
      throw new Error(quota.reason ?? "Quota exceeded");
    }
    await supabase.from("multimedia_analysis_jobs")
      .update({ estimated_cost_cents: est }).eq("id", jobId);

    // Fire background runner (best-effort — Cloudflare Workers don't guarantee
    // background execution after response, so we await it here for correctness).
    await runPipeline(supabase, userId, jobId, data);
    return { jobId };
  });

async function runPipeline(supabase: any, userId: string, jobId: string, input: StartInput) {
  const { getProviderConfig } = await import("./providers.server");
  const { detectLanguage, translateText } = await import("./translation.server");
  const { extractSearchableClaims } = await import("./claims.server");
  const { searchFactChecks, classifyReviews } = await import("./factcheck.server");
  const { computeRiskScores, explainRiskScores } = await import("./risk.server");

  const cfg = getProviderConfig();
  const stage: Record<Stage, string> = Object.fromEntries(STAGES.map((s) => [s, "pending"])) as any;
  const markStage = async (s: Stage, status: string, msg?: string, percent?: number) => {
    stage[s] = status;
    await supabase.from("multimedia_analysis_jobs").update({
      stage_status: stage,
      progress_message: msg ?? null,
      progress_percent: percent ?? Math.round((STAGES.indexOf(s) / STAGES.length) * 100),
    }).eq("id", jobId);
  };
  const logError = async (s: Stage, provider: string, reason: string) => {
    await supabase.from("multimedia_errors").insert({
      user_id: userId, job_id: jobId, stage: s, provider, error_message: reason,
    });
  };

  const meta = input.source_metadata ?? {};
  const combinedText = [meta.title, meta.description, meta.transcript, meta.ocr_text].filter(Boolean).join("\n\n");
  const nameTerms = [input.target_name, ...(input.target_aliases ?? [])].filter(Boolean);

  await markStage("prepare", "done", "Analysis prepared", 5);
  await markStage("upload", cfg.hasServiceAccount ? "pending" : "skipped", cfg.hasServiceAccount ? undefined : "No authorized media uploaded — metadata-only mode");

  // Video Intelligence
  if (cfg.videoIntelligence === "stub") {
    await markStage("video_intelligence", "unavailable", "Cloud Video Intelligence requires service account credentials");
    await logError("video_intelligence", "google_video_intelligence", "GCP org policy blocks service account key creation");
  } else {
    await markStage("video_intelligence", "skipped", "No authorized video file provided");
  }

  // Speech-to-Text
  if (cfg.speechToText === "stub") {
    await markStage("audio_extract", "unavailable", "Requires service account");
    await markStage("transcription", "unavailable", "Cloud Speech-to-Text requires service account credentials");
    await logError("transcription", "google_speech_to_text", "GCP org policy blocks service account key creation");
  } else {
    await markStage("audio_extract", "skipped");
    await markStage("transcription", "skipped");
  }

  // Mention detection over provided text (title/description/caption if any)
  const mentionRegex = new RegExp(
    nameTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "gi",
  );
  const mentionCount = nameTerms.length ? (combinedText.match(mentionRegex) ?? []).length : 0;
  await markStage("mention_detect", mentionCount > 0 ? "done" : "empty", `${mentionCount} textual mentions`, 35);

  // Vision
  if (cfg.vision === "stub") {
    await markStage("vision_frames", "unavailable", "Cloud Vision requires service account credentials");
    await logError("vision_frames", "google_vision", "GCP org policy blocks service account key creation");
  } else {
    await markStage("vision_frames", "skipped");
  }

  // Translation of the provided text if non-English
  let translationLow = false;
  let detectedLang: string | null = meta.language_code ?? null;
  let translatedText: string | null = null;
  if (combinedText.trim() && cfg.translation !== "stub") {
    await markStage("translation", "running", "Detecting language");
    const det = await detectLanguage(combinedText);
    if (det.status === "ok" && det.data) {
      detectedLang = det.data.language;
      if (det.data.language !== "en") {
        const tr = await translateText(combinedText, "en", det.data.language);
        if (tr.status === "ok" && tr.data) {
          translatedText = tr.data.translatedText;
          await supabase.from("translations").insert({
            user_id: userId, job_id: jobId,
            source_type: "combined_text", detected_language: det.data.language, target_language: "en",
            original_text: combinedText.slice(0, 8000), translated_text: tr.data.translatedText.slice(0, 8000),
            confidence: tr.data.confidence, provider: tr.data.provider,
            requires_review: (tr.data.confidence ?? 1) < 0.6,
          });
          translationLow = (tr.data.confidence ?? 1) < 0.6;
          await markStage("translation", "done", `Translated from ${det.data.language}`, 55);
        } else {
          await markStage("translation", "failed", tr.reason);
          await logError("translation", "google_translate_v2", tr.reason ?? "unknown");
        }
      } else {
        await markStage("translation", "done", "Content already in English", 55);
      }
    } else {
      await markStage("translation", det.status === "unavailable" ? "unavailable" : "failed", det.reason);
      if (det.status !== "unavailable") await logError("translation", "google_translate_v2", det.reason ?? "unknown");
    }
  } else {
    await markStage("translation", cfg.translation === "stub" ? "unavailable" : "empty", cfg.translation === "stub" ? "Translation not configured" : "No text to translate");
  }

  // Claim extraction (Gemini via Lovable AI Gateway) + Fact Check
  const analysisText = translatedText ?? combinedText;
  let extractedClaims: Array<{ id: string; claim: string; original_snippet: string; claimant?: string }> = [];
  if (analysisText.trim()) {
    await markStage("claim_extract", "running", "Extracting searchable claims");
    const claims = await extractSearchableClaims(analysisText, input.target_name);
    if (claims.status === "ok" && claims.data && claims.data.length) {
      const rows = claims.data.map((c) => ({
        user_id: userId, job_id: jobId,
        original_statement: c.original_snippet, extracted_claim: c.claim,
        claimant: c.claimant ?? null, language: detectedLang ?? "en", fact_check_status: "pending",
      }));
      const { data: ins } = await supabase.from("extracted_claims").insert(rows).select("id, extracted_claim, original_statement, claimant");
      extractedClaims = (ins ?? []).map((r: any) => ({ id: r.id, claim: r.extracted_claim, original_snippet: r.original_statement, claimant: r.claimant }));
      await markStage("claim_extract", "done", `${extractedClaims.length} claims extracted`, 70);
    } else if (claims.status === "ok") {
      await markStage("claim_extract", "empty", "No searchable claims found", 70);
    } else {
      await markStage("claim_extract", "failed", claims.reason);
      await logError("claim_extract", "gemini", claims.reason ?? "unknown");
    }
  } else {
    await markStage("claim_extract", "empty", "No text to analyze", 70);
  }

  let factChecksFalse = 0;
  let factChecksReviewed = 0;
  if (extractedClaims.length) {
    await markStage("fact_check", "running", `Searching Fact Check Tools for ${extractedClaims.length} claims`);
    for (const c of extractedClaims) {
      const fc = await searchFactChecks(c.claim, { languageCode: detectedLang ?? "en", pageSize: 5 });
      if (fc.status !== "ok" || !fc.data?.claims?.length) {
        if (fc.status !== "ok" && fc.status !== "unavailable") await logError("fact_check", "google_fact_check", fc.reason ?? "unknown");
        continue;
      }
      const reviews = fc.data.claims.flatMap((cc) => cc.claimReview ?? []);
      if (!reviews.length) continue;
      factChecksReviewed++;
      const cls = classifyReviews(reviews);
      const isFalseish = ["rated_false", "rated_misleading", "rated_partly_false"].includes(cls);
      if (isFalseish) factChecksFalse++;

      const matchRows = reviews.slice(0, 5).map((r) => ({
        user_id: userId, job_id: jobId, extracted_claim_id: c.id,
        publisher_name: r.publisher?.name ?? null, publisher_site: r.publisher?.site ?? null,
        review_title: r.title ?? null, review_url: r.url ?? null,
        review_date: r.reviewDate ?? null, textual_rating: r.textualRating ?? null,
        language: r.languageCode ?? null,
        reviewed_claim: fc.data?.claims?.find((cc) => cc.claimReview?.includes(r))?.text ?? null,
        match_confidence: 0.6, raw: r as any,
      }));
      await supabase.from("fact_check_matches").insert(matchRows);
      await supabase.from("extracted_claims").update({ fact_check_status: cls }).eq("id", c.id);

      // Push high-signal fact-check hits into the timeline
      if (isFalseish || cls === "conflicting") {
        await supabase.from("timestamp_findings").insert({
          user_id: userId, job_id: jobId,
          finding_type: "fact_check",
          start_seconds: 0, severity: isFalseish ? "high" : "medium",
          title: `Claim previously reviewed: ${cls.replace(/_/g, " ")}`,
          description: c.claim,
          transcript_excerpt: c.original_snippet,
          original_language: detectedLang, translation: translatedText ? c.claim : null,
          extracted_claim_id: c.id, fact_check_status: cls,
          confidence: 0.7,
          detection_reason: `Publisher review: ${reviews[0]?.publisher?.name ?? "unknown"}`,
          youtube_deep_link: meta.video_id ? `https://www.youtube.com/watch?v=${meta.video_id}` : null,
        });
      }
    }
    await markStage("fact_check", "done", `${factChecksReviewed} claims reviewed, ${factChecksFalse} rated false/misleading`, 82);
  } else {
    await markStage("fact_check", "empty", "No claims to check", 82);
  }

  // Also synthesize a "mention" timeline finding when the protected name appears in text
  if (mentionCount > 0) {
    await supabase.from("timestamp_findings").insert({
      user_id: userId, job_id: jobId,
      finding_type: "name_mention",
      start_seconds: 0, severity: mentionCount >= 3 ? "medium" : "low",
      title: `Protected name mentioned in metadata (${mentionCount}x)`,
      description: `The target "${input.target_name}" appears ${mentionCount} times in the available text.`,
      transcript_excerpt: combinedText.slice(0, 500),
      original_language: detectedLang, translation: translatedText?.slice(0, 500) ?? null,
      confidence: 0.9,
      detection_reason: "Exact string match against name and aliases",
      youtube_deep_link: meta.video_id ? `https://www.youtube.com/watch?v=${meta.video_id}` : null,
    });
  }

  // Risk scoring — explainable
  await markStage("risk_score", "running");
  const inputs = {
    transcriptHits: mentionCount,
    visualHits: 0, assetMatches: 0,
    factChecksFalse, factChecksReviewed,
    criticalFindings: 0,
    highFindings: factChecksFalse,
    reachEstimate: meta.view_count ?? 0,
    translationLowConfidence: translationLow,
    transcriptAvgConfidence: 0.75,
  };
  const explained = explainRiskScores(inputs);
  const risk = explained.scores;
  const reputationScore = Math.max(0, 100 - risk.reputation);
  await markStage("risk_score", "done", "Risk scored", 90);

  await markStage("save_evidence", "done", "Evidence records saved", 93);
  await markStage("threat_radar", risk.reputation >= 60 ? "queued" : "skipped", risk.reputation >= 60 ? "High-risk findings queued for Threat Radar review" : "Below Threat Radar threshold");

  // Determine overall status
  const stageValues = Object.values(stage);
  const anyFailed = stageValues.includes("failed");
  const overall = anyFailed ? "partial" : "completed";
  await supabase.from("multimedia_analysis_jobs").update({
    status: overall,
    stage_status: { ...stage, finalize: "done" },
    progress_percent: 100,
    progress_message: "Analysis complete",
    reputation_score: reputationScore,
    risk_scores: risk,
    confidence_by_axis: explained.explanations as any,
    finished_at: new Date().toISOString(),
  }).eq("id", jobId);

  // Auto-cluster this job's findings so Narrative Intelligence stays fresh.
  // Cluster key logic mirrors narrative.functions.ts.
  try {
    const { data: jobFindings } = await supabase.from("timestamp_findings")
      .select("id, extracted_claim_id, title").eq("job_id", jobId);
    const metaVid = meta.video_id;
    const clusterKey = metaVid
      ? `video:${metaVid}`
      : input.source_ref.startsWith("http")
        ? `url:${(() => { try { const u = new URL(input.source_ref); return `${u.host}${u.pathname}`.toLowerCase(); } catch { return input.source_ref; } })()}`
        : `title:${(meta.title ?? input.target_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`;
    const { data: existingCluster } = await supabase.from("narrative_clusters")
      .select("id, source_count, combined_reach, first_detected_at")
      .eq("user_id", userId).eq("cluster_key", clusterKey).maybeSingle();
    const nowIso = new Date().toISOString();
    let clusterId: string;
    if (existingCluster?.id) {
      clusterId = existingCluster.id as string;
      await supabase.from("narrative_clusters").update({
        source_count: (existingCluster.source_count ?? 0) + 1,
        combined_reach: (existingCluster.combined_reach ?? 0) + (meta.view_count ?? 0),
        latest_detected_at: nowIso,
        dominant_source: input.source_kind,
      }).eq("id", clusterId);
    } else {
      const { data: ins } = await supabase.from("narrative_clusters").insert({
        user_id: userId, cluster_key: clusterKey, target_name: input.target_name,
        source_count: 1, combined_reach: meta.view_count ?? 0,
        first_detected_at: nowIso, latest_detected_at: nowIso,
        dominant_source: input.source_kind,
        narrative_summary: meta.title ?? input.target_name,
        sources: [input.source_ref] as any,
      }).select("id").single();
      clusterId = ins!.id as string;
    }
    if (jobFindings && jobFindings.length && clusterId) {
      await supabase.from("timestamp_findings").update({ cluster_id: clusterId } as any)
        .in("id", jobFindings.map((f: any) => f.id));
    }
  } catch (e) {
    // Non-fatal — clustering is a background enrichment.
    console.warn("[mm] clustering failed", e);
  }
}

// -----------------------------------------------------------------------------
// Read queries
// -----------------------------------------------------------------------------

export const getMultimediaJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ jobId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [job, findings, claims, checks, translations, errors] = await Promise.all([
      supabase.from("multimedia_analysis_jobs").select("*").eq("id", data.jobId).maybeSingle(),
      supabase.from("timestamp_findings").select("*").eq("job_id", data.jobId).order("start_seconds"),
      supabase.from("extracted_claims").select("*").eq("job_id", data.jobId).order("created_at"),
      supabase.from("fact_check_matches").select("*").eq("job_id", data.jobId).order("created_at"),
      supabase.from("translations").select("*").eq("job_id", data.jobId).order("created_at"),
      supabase.from("multimedia_errors").select("*").eq("job_id", data.jobId).order("created_at"),
    ]);
    return {
      job: job.data ?? null,
      findings: findings.data ?? [],
      claims: claims.data ?? [],
      checks: checks.data ?? [],
      translations: translations.data ?? [],
      errors: errors.data ?? [],
    };
  });

export const listMultimediaJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase.from("multimedia_analysis_jobs")
      .select("id, source_kind, source_ref, target_name, status, reputation_score, progress_percent, created_at, source_metadata")
      .order("created_at", { ascending: false })
      .limit(50);
    return { jobs: data ?? [] };
  });

export const updateFindingReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    findingId: z.string().uuid(),
    review_status: z.enum(["pending", "confirmed", "false_positive", "sent_to_radar"]),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("timestamp_findings")
      .update({ review_status: data.review_status })
      .eq("id", data.findingId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listProtectedAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase.from("protected_assets")
      .select("*").eq("active", true).order("created_at", { ascending: false });
    return { assets: data ?? [] };
  });

export const upsertProtectedAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(200),
    kind: z.enum(["logo", "photo", "product", "artwork", "watermark", "frame", "other"]),
    source_url: z.string().url().optional(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase.from("protected_assets")
        .update({ name: data.name, kind: data.kind, source_url: data.source_url ?? null })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await supabase.from("protected_assets").insert({
      user_id: userId, name: data.name, kind: data.kind, source_url: data.source_url ?? null,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id as string };
  });

export const getProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getProviderConfig } = await import("./providers.server");
    const cfg = getProviderConfig();
    return {
      videoIntelligence: cfg.videoIntelligence,
      speechToText: cfg.speechToText,
      vision: cfg.vision,
      translation: cfg.translation,
      factCheck: cfg.factCheck,
      hasServiceAccount: cfg.hasServiceAccount,
      hasFactCheckKey: Boolean(cfg.factCheckApiKey),
      hasTranslationKey: Boolean(cfg.googleApiKey),
      projectId: cfg.projectId,
      bucket: cfg.bucket,
    };
  });

export const fetchYoutubeMetadataFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ url: z.string().min(3).max(500) }).parse(raw))
  .handler(async ({ data }) => {
    const { extractYoutubeId, fetchYoutubeMetadata } = await import("./youtube.server");
    const id = extractYoutubeId(data.url);
    if (!id) throw new Error("Not a valid YouTube URL");
    const res = await fetchYoutubeMetadata(id);
    if (res.status !== "ok" || !res.data) {
      return { ok: false as const, reason: res.reason ?? "metadata unavailable", video_id: id };
    }
    return { ok: true as const, metadata: res.data };
  });

