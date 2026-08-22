/**
 * YouTube Removal / impersonation-monitoring dispatch. Reuses the real
 * production pipeline entry point as-is — runYoutubeRemovalScan already
 * takes explicit (supabase, userId, scanId, scope) args with no session
 * coupling (it's already called this way internally by the manual UI's
 * fire-and-forget dispatch), so no extraction refactor was needed here.
 */
import { AutoEnforcementOrchestrator, type FindingShape } from "@/lib/enforcement/orchestrator";
import { captureAndRecordFindingEvidence } from "@/lib/protection/evidence.server";

export interface YoutubeRemovalOutcome {
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

interface ProtectionProfileLike {
  display_name: string | null;
  verified_name: string | null;
}

export interface YoutubeFindingLike {
  id: string;
  video_url?: string;
  title?: string | null;
  subject_status: string | null;
  channel_class: string | null;
  risk_level: string | null;
  recommended_action: string | null;
}

/**
 * Pure gate, split out for direct unit testing: which findings from a
 * completed scan are actionable enough to warrant evidence capture + case
 * preparation. Excludes unverified subjects, official-news exclusions, and
 * anything below high/critical risk with no recommended action.
 */
export function selectActionableYoutubeFindings<T extends YoutubeFindingLike>(findings: T[]): T[] {
  return findings.filter(
    (f) =>
      f.subject_status !== "not_subject" &&
      f.channel_class !== "official_news" &&
      (f.risk_level === "high" || f.risk_level === "critical") &&
      !!f.recommended_action,
  );
}

export interface YoutubeRemovalDispatchDeps {
  runYoutubeRemovalScan?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    userId: string,
    scanId: string,
    scope: "NON_OFFICIAL_ONLY" | "NEWS_ALLEGATIONS" | "ALL_SOURCES",
  ) => Promise<unknown>;

  captureEvidence?: typeof captureAndRecordFindingEvidence;
  onVerifiedFinding?: typeof AutoEnforcementOrchestrator.onVerifiedFinding;
}

export async function runYoutubeRemovalForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  profile: ProtectionProfileLike,
  deps: YoutubeRemovalDispatchDeps = {},
): Promise<YoutubeRemovalOutcome> {
  const targetName = (profile.display_name || profile.verified_name || "").trim();
  if (!targetName) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_SUBJECT_NAME",
    };
  }

  // Avoid overlapping runs for the same customer.
  const { data: inFlight } = await supabaseAdmin
    .from("youtube_removal_scans")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();
  if (inFlight) {
    return {
      status: "RUNNING",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: null,
    };
  }

  const { data: profileRow } = await supabaseAdmin
    .from("protection_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  const { data: aliasRows } = profileRow
    ? await supabaseAdmin
        .from("protection_profile_aliases")
        .select("alias")
        .eq("profile_id", profileRow.id)
        .eq("active", true)
    : { data: [] as { alias: string }[] };
  const aliases = (aliasRows ?? [])
    .map((a: { alias: string }) => a.alias)
    .filter((a: string) => a && a.toLowerCase() !== targetName.toLowerCase())
    .slice(0, 10);

  const { buildQueryPlan } = await import("@/lib/youtube-removal/queries");
  const scope = "NON_OFFICIAL_ONLY" as const;
  const queries = buildQueryPlan({ targetName, aliases });

  const { data: scan, error: insertErr } = await supabaseAdmin
    .from("youtube_removal_scans")
    .insert({
      user_id: userId,
      target_name: targetName,
      aliases,
      status: "queued",
      stage: "queued",
      queries,
      source_scope: scope,
    })
    .select("id")
    .single();
  if (insertErr || !scan) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: insertErr?.message?.slice(0, 200) ?? "SCAN_CREATE_FAILED",
    };
  }

  try {
    const runYoutubeRemovalScan =
      deps.runYoutubeRemovalScan ??
      (await import("@/lib/youtube-removal/scan.server")).runYoutubeRemovalScan;
    await runYoutubeRemovalScan(supabaseAdmin, userId, scan.id, scope);
  } catch (err) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: (err as Error).message?.slice(0, 200) ?? "SCAN_EXECUTION_FAILED",
    };
  }

  const { data: findings } = await supabaseAdmin
    .from("youtube_removal_findings")
    .select("id, video_url, title, subject_status, channel_class, risk_level, recommended_action")
    .eq("scan_id", scan.id);
  const rows = findings ?? [];

  const actionable = selectActionableYoutubeFindings(rows as YoutubeFindingLike[]);

  const captureEvidence = deps.captureEvidence ?? captureAndRecordFindingEvidence;
  const onVerifiedFinding = deps.onVerifiedFinding ?? AutoEnforcementOrchestrator.onVerifiedFinding;

  for (const finding of actionable) {
    try {
      const evidence = await captureEvidence(supabaseAdmin, {
        userId,
        moduleKey: "youtube_removal",
        findingSourceTable: "youtube_removal_findings",
        findingId: finding.id as string,
        url: finding.video_url as string,
        title: (finding.title as string) ?? undefined,
        mediaType: "video",
      });
      if (evidence.status === "capture_failed") continue;

      const shapedFinding: FindingShape = {
        id: finding.id as string,
        source: "youtube_removal",
        source_type: "youtube",
        canonical_url: finding.video_url as string,
        title: (finding.title as string) ?? null,
        risk_type: "IMPERSONATION",
      };
      await onVerifiedFinding(supabaseAdmin, userId, shapedFinding);
    } catch (err) {
      console.error("[protection:youtube-removal] case prep failed", finding.id, err);
    }
  }

  return {
    status: "COMPLETED",
    candidates_found: rows.length,
    verified_findings: actionable.length,
    blocked_reason: null,
  };
}
