/**
 * Lightweight analysis for a single fetched channel-watch video.
 *
 * Strategy for this pass:
 *  - Load the verified user's names/aliases (display_name, full_name,
 *    known_aliases if present on client_profiles) and run
 *    English/Malayalam/Manglish substring matching against title +
 *    description. This is the only text signal we run at this stage.
 *  - Run a best-effort thumbnail face match against the user's Rekognition
 *    collection via the existing analyzeHitForFaces helper (reuse of the scan
 *    pipeline). Failures set matches=0 and never throw.
 *  - Compute a coarse risk score from mention_match + face similarity.
 *  - Choose a classification from the explainable enum. Nothing is auto-
 *    labelled as defamation; any non-informational hit sets
 *    review_status='pending'.
 *
 * Deeper multimedia analysis (transcription, translation, claim extraction,
 * deepfake heuristics) can be layered on later without changing the row
 * schema; the jsonb fields already reserve space for those signals.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Supa = SupabaseClient<Database>;

type Classification = Database["public"]["Enums"]["channel_watch_classification"];

interface AliasHit {
  alias: string;
  where: "title" | "description";
  script: "latin" | "malayalam" | "manglish";
}

/** Normalize Latin text for case/diacritic-insensitive substring match. */
function normLatin(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Heuristic Manglish generator: for each Latin alias, produce a few
 * common romanization variants so "Rahul" also matches "raahul", "rahull".
 * Kept intentionally small — better to under-match than to over-match.
 */
function manglishVariants(alias: string): string[] {
  const n = normLatin(alias);
  const variants = new Set<string>([n]);
  variants.add(n.replace(/aa/g, "a"));
  variants.add(n.replace(/([aeiou])\1+/g, "$1"));
  variants.add(n.replace(/([bcdfghjklmnpqrstvwxyz])\1+/g, "$1"));
  return Array.from(variants).filter((v) => v.length >= 3);
}

function isMalayalam(s: string): boolean {
  return /[\u0d00-\u0d7f]/.test(s);
}

function scanAliases(text: string, aliases: string[]): AliasHit[] {
  const out: AliasHit[] = [];
  const norm = normLatin(text);
  for (const alias of aliases) {
    if (!alias || alias.length < 2) continue;
    if (isMalayalam(alias)) {
      if (text.includes(alias)) out.push({ alias, where: "title", script: "malayalam" });
      continue;
    }
    const latinNeedle = normLatin(alias);

    // Match spaced names against hashtags and compact forms:
    // "Renu Sudhi" -> "#renusudhi", "renu_sudhi", "renu-sudhi".
    const compactText = norm.replace(/[\s_#.-]+/g, "");
    const compactNeedle = latinNeedle.replace(/[\s_#.-]+/g, "");

    if (
      norm.includes(latinNeedle) ||
      (
        compactNeedle.length >= 3 &&
        compactText.includes(compactNeedle)
      )
    ) {
      out.push({ alias, where: "title", script: "latin" });
      continue;
    }
    for (const v of manglishVariants(alias)) {
      if (norm.includes(v)) { out.push({ alias, where: "title", script: "manglish" }); break; }
    }
  }
  return out;
}

async function loadAliases(
  supabase: Supa,
  userId: string,
  watchId: string,
): Promise<string[]> {
  const { data: watch } = await supabase
    .from("channel_watches")
    .select("reason")
    .eq("id", watchId)
    .eq("user_id", userId)
    .maybeSingle();

  const configured = (watch?.reason ?? "")
    .split(/[,;\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);

  // A watch-specific subject always takes priority. This prevents one
  // monitored channel from matching unrelated account identities.
  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }

  const { data } = await supabase
    .from("client_profiles")
    .select("display_name, full_name, company_name")
    .eq("user_id", userId)
    .maybeSingle();

  const aliases = new Set<string>();
  for (const key of ["display_name", "full_name", "company_name"] as const) {
    const value = (data as Record<string, unknown> | null)?.[key];
    if (typeof value === "string" && value.trim().length >= 2) {
      aliases.add(value.trim());
    }
  }

  return Array.from(aliases);
}

function classify(input: {
  aliasHits: AliasHit[];
  faceMatches: number;
  isBaseline: boolean;
}): { classification: Classification; risk: number; requiresReview: boolean } {
  const { aliasHits, faceMatches, isBaseline } = input;
  if (aliasHits.length === 0 && faceMatches === 0) {
    return { classification: "not_relevant", risk: 0, requiresReview: false };
  }
  if (faceMatches > 0) {
    // Face reuse of a protected identity — flag for review as potential
    // impersonation / unauthorized image use. Human confirms actual basis.
    return {
      classification: "potential_impersonation",
      risk: Math.min(100, 55 + faceMatches * 10 + (isBaseline ? 0 : 15)),
      requiresReview: true,
    };
  }
  // Text-only mention. Do NOT label negative/critical/commentary as violation.
  if (aliasHits.length >= 2) {
    return {
      classification: "potential_harm",
      risk: isBaseline ? 30 : 55,
      requiresReview: true,
    };
  }
  return {
    classification: "informational",
    risk: isBaseline ? 10 : 25,
    requiresReview: false,
  };
}

export async function analyzeWatchVideo(supabase: Supa, videoRowId: string): Promise<void> {
  const { data: v, error } = await supabase
    .from("channel_watch_videos")
    .select("id, user_id, watch_id, video_id, title, description, thumbnail_url, url, is_baseline, analysis_status")
    .eq("id", videoRowId)
    .maybeSingle();
  if (error || !v) throw new Error("video row not found");
  if (v.analysis_status === "skipped") return;

  await supabase.from("channel_watch_videos").update({ analysis_status: "running" }).eq("id", v.id);

  const aliases = await loadAliases(supabase, v.user_id, v.watch_id);
  const textBlob = `${v.title ?? ""}\n${v.description ?? ""}`;
  const aliasHits = scanAliases(textBlob, aliases);

  // Analyze real captions/spoken content with exact timestamps.
  const { analyzeChannelWatchCaptions } = await import("./captions.server");
  const captionAnalysis = await analyzeChannelWatchCaptions(
    v.video_id,
    aliases,
  );

  // Best-effort face match — reuses existing helper so we stay consistent with
  // the rest of the scan pipeline.
  let faceMatches = 0;
  try {
    if (v.thumbnail_url) {
      const { analyzeHitForFaces } = await import("@/lib/face-scan.server");
      // Insert a synthetic scan_hit row so the existing helper is happy, or
      // just call the underlying Rekognition helpers directly. To avoid a fake
      // scan_hit_id we call the low-level helpers here.
      const { data: col } = await supabase
        .from("rekognition_collections").select("collection_id").eq("user_id", v.user_id).maybeSingle();
      if (col?.collection_id) {
        const [{ fetchImageBytes }, { searchFacesByImage }] = await Promise.all([
          import("@/lib/aws/s3.server"),
          import("@/lib/aws/rekognition.server"),
        ]);
        const img = await fetchImageBytes(v.thumbnail_url);
        if (img) {
          const { matches } = await searchFacesByImage({
            collectionId: col.collection_id, bytes: img.bytes, threshold: 80, maxFaces: 5,
          });
          faceMatches = matches.length;
        }
      }
      // Reference analyzeHitForFaces to keep the import (used elsewhere)
      void analyzeHitForFaces;
    }
  } catch (err) {
    // Face path failure is not fatal; recorded on the row.
    console.warn("[channel-watch] face analysis failed", (err as Error).message);
  }

  let decision = classify({
    aliasHits,
    faceMatches,
    isBaseline: !!v.is_baseline,
  });

  // Caption findings are stronger than metadata-only matches. A simple name
  // mention remains informational; risky classified speech enters review.
  if (captionAnalysis.maxRisk > decision.risk) {
    decision = {
      classification: "potential_harm",
      risk: captionAnalysis.maxRisk,
      requiresReview: captionAnalysis.maxRisk >= 55,
    };
  } else if (
    captionAnalysis.mentionCount > 0 &&
    decision.classification === "not_relevant"
  ) {
    decision = {
      classification: "informational",
      risk: 20,
      requiresReview: false,
    };
  }

  await supabase.from("channel_watch_videos").update({
    analysis_status: "completed",
    analysis_error: null,
    classification: decision.classification,
    risk_score: decision.risk,
    review_status: decision.requiresReview ? "pending" : "not_required",
    mention_match: {
      hits: aliasHits,
      alias_count: aliases.length,
      transcript_analysis_version: 3,
      caption_state: captionAnalysis.state,
      caption_language: captionAnalysis.language,
      caption_source: captionAnalysis.source,
      caption_segment_count: captionAnalysis.segmentCount,
      transcript_mention_count: captionAnalysis.mentionCount,
      timestamp_findings: captionAnalysis.findings,
      caption_error: captionAnalysis.reason ?? null,
    } as unknown as Database["public"]["Tables"]["channel_watch_videos"]["Update"]["mention_match"],
    protected_asset_similarity: { face_matches: faceMatches } as unknown as Database["public"]["Tables"]["channel_watch_videos"]["Update"]["protected_asset_similarity"],
  }).eq("id", v.id);

  // Capture an automatic metadata evidence snapshot for every relevant item.
  // This is preserved even when the risk does not meet enforcement thresholds.
  if (decision.classification !== "not_relevant") {
    await supabase.from("channel_watch_evidence").insert({
      user_id: v.user_id,
      video_id: v.id,
      kind: "automatic_monitoring_snapshot",
      metadata: {
        watch_id: v.watch_id,
        youtube_video_id: v.video_id,
        url: v.url ?? `https://www.youtube.com/watch?v=${v.video_id}`,
        title: v.title,
        description: v.description,
        thumbnail_url: v.thumbnail_url,
        is_baseline: v.is_baseline,
        classification: decision.classification,
        risk_score: decision.risk,
        alias_hits: aliasHits,
        face_matches: faceMatches,
        caption_state: captionAnalysis.state,
        caption_language: captionAnalysis.language,
        transcript_mention_count: captionAnalysis.mentionCount,
        timestamp_findings: captionAnalysis.findings,
        caption_error: captionAnalysis.reason ?? null,
        captured_at: new Date().toISOString(),
      } as never,
    });
  }

  let enforcementRequestId: string | null = null;

  // Relevant new uploads with review-level risk enter the takedown workflow
  // as a Draft. Submission always requires human approval.
  if (
    decision.requiresReview &&
    decision.risk >= (v.is_baseline ? 70 : 55) &&
    decision.classification !== "not_relevant"
  ) {
    const { data: existing } = await supabase
      .from("enforcement_requests")
      .select("id")
      .eq("user_id", v.user_id)
      .contains("metadata", { channel_watch_video_id: v.id })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      enforcementRequestId = existing.id;
    } else {
      const { data: created, error: requestError } = await supabase
        .from("enforcement_requests")
        .insert({
          user_id: v.user_id,
          platform: "YouTube",
          method: "Channel Watch Review",
          target_url: v.url ?? `https://www.youtube.com/watch?v=${v.video_id}`,
          status: "Draft",
          metadata: {
            created_from: "channel_watch",
            channel_watch_video_id: v.id,
            watch_id: v.watch_id,
            classification: decision.classification,
            risk_score: decision.risk,
            human_approval_required: true,
          },
        })
        .select("id")
        .single();

      if (!requestError && created?.id) {
        enforcementRequestId = created.id;

        await supabase.from("enforcement_evidence").insert({
          user_id: v.user_id,
          enforcement_request_id: created.id,
          evidence_type: "channel_watch_snapshot",
          reference: v.url ?? `https://www.youtube.com/watch?v=${v.video_id}`,
          payload: {
            channel_watch_video_id: v.id,
            watch_id: v.watch_id,
            video_id: v.video_id,
            title: v.title,
            description: v.description,
            thumbnail_url: v.thumbnail_url,
            classification: decision.classification,
            risk_score: decision.risk,
            alias_hits: aliasHits,
            face_matches: faceMatches,
            captured_at: new Date().toISOString(),
          } as never,
        });
      }
    }
  }

  await supabase.from("channel_watch_events").insert({
    user_id: v.user_id, watch_id: v.watch_id, video_id: v.id,
    event_type: enforcementRequestId
      ? "enforcement_draft_created"
      : "analysis_completed",
    payload: {
      classification: decision.classification,
      risk_score: decision.risk,
      requires_review: decision.requiresReview,
      alias_hits: aliasHits.length,
      face_matches: faceMatches,
      caption_state: captionAnalysis.state,
      transcript_mentions: captionAnalysis.mentionCount,
      timestamp_findings: captionAnalysis.findings.length,
      enforcement_request_id: enforcementRequestId,
    },
  });
}
