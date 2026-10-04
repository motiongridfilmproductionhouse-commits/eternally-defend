/**
 * Protection Inbox server functions — READ-ONLY over existing pipeline data.
 *
 * Reads the automated YouTube discovery findings the existing autopilot
 * already produces, plus the enforcement cases the existing orchestrator
 * already created, and returns them classified for the customer inbox.
 * It creates nothing, approves nothing and sends nothing.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildProtectionInbox, type InboxFindingInput, type InboxItem } from "./inbox";
import {
  isApprovedSourceVideo,
  listApprovedSourceVideoIds,
} from "./sources/approved-video-ids";

const MAX_FINDINGS = 150;

export interface InboxRemovalRow {
  id: string;
  targetUrl: string | null;
  platform: string;
  method: string;
  status: string;
  submissionStatus: string | null;
  submittedAt: string | null;
  createdAt: string;
  thumbnailPath: string | null;
  firstVideoSubmittedAt: string | null;
  removedAt: string | null;
  reportNumber: string | null;
  removedVideoCount: number | null;
  escalatedToManualTeam: boolean;
  evidenceAttachments: Array<{
    label: string;
    path: string;
    contentType: string | null;
  }>;
}

interface ProtectionInboxData {
  discovery: {
    lastScanAt: string | null;
    status: string | null;
    running: boolean;
    targetName: string | null;
  };
  items: InboxItem[];
  removals: InboxRemovalRow[];
  summary: {
    analyzed: number;
    possibleRemoval: number;
    needsReview: number;
    monitoring: number;
    removalsInProgress: number;
  };
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function metadataNumber(metadata: Record<string, unknown> | null, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === "number" ? value : null;
}

function metadataAttachments(metadata: Record<string, unknown> | null): InboxRemovalRow["evidenceAttachments"] {
  const value = metadata?.["evidence_attachments"];
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || Array.isArray(item) || typeof item !== "object") return [];
    const attachment = item as Record<string, unknown>;
    if (typeof attachment["label"] !== "string" || typeof attachment["path"] !== "string") {
      return [];
    }
    return [{
      label: attachment["label"],
      path: attachment["path"],
      contentType: typeof attachment["content_type"] === "string" ? attachment["content_type"] : null,
    }];
  });
}

/** Read-only view of removal requests already submitted for this user. */
async function readSubmittedRemovals(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<InboxRemovalRow[]> {
  const { data } = await supabase
    .from("enforcement_requests")
    .select(
      "id, target_url, platform, method, status, submission_status, submitted_at, created_at, user_id, metadata",
    )
    .eq("user_id", userId)
    .in("status", ["Sent", "Approved", "Rejected"])
    .order("submitted_at", { ascending: false })
    .limit(100);

  return (data ?? []).map((r: Record<string, unknown>) => {
    const metadata = metadataObject(r["metadata"]);
    return {
      id: String(r["id"]),
      targetUrl: (r["target_url"] as string) ?? null,
      platform: (r["platform"] as string) ?? "—",
      method: (r["method"] as string) ?? "—",
      status: (r["status"] as string) ?? "—",
      submissionStatus: (r["submission_status"] as string) ?? null,
      submittedAt: (r["submitted_at"] as string) ?? null,
      createdAt: (r["created_at"] as string) ?? "",
      thumbnailPath: metadataString(metadata, "thumbnail_path"),
      firstVideoSubmittedAt: metadataString(metadata, "first_video_submitted_at"),
      removedAt: metadataString(metadata, "removed_at"),
      reportNumber: metadataString(metadata, "intellectual_property_report_number"),
      removedVideoCount: metadataNumber(metadata, "removed_video_count"),
      escalatedToManualTeam:
        metadataString(metadata, "escalation_status") === "escalated_to_manual_removal_team",
      evidenceAttachments: metadataAttachments(metadata),
    };
  });
}

export const getProtectionInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProtectionInboxData> => {
    const removals = await readSubmittedRemovals(context.supabase, context.userId);

    const { data: scans } = await context.supabase
      .from("youtube_removal_scans")
      .select("id, status, stage, created_at, updated_at, target_name")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(3);

    const scanRows = scans ?? [];
    const latest = scanRows[0] ?? null;
    const scanIds = scanRows.map((s) => s.id);

    if (scanIds.length === 0) {
      return {
        discovery: { lastScanAt: null, status: null, running: false, targetName: null },
        items: [],
        removals,
        summary: {
          analyzed: 0,
          possibleRemoval: 0,
          needsReview: 0,
          monitoring: 0,
          removalsInProgress: removals.filter((r) => r.status === "Sent").length,
        },
      };
    }


    const { data: findings, error } = await context.supabase
      .from("youtube_removal_findings")
      .select(
        "id, video_url, title, channel_title, channel_url, thumbnail_url, published_at, subject_status, subject_confidence, channel_class, risk_level, removal_potential, recommended_action, potential_violation, assessment_reason, evidence_verified, transcript_state, priority_score",
      )
      .eq("user_id", context.userId)
      .in("scan_id", scanIds)
      .order("priority_score", { ascending: false })
      .limit(MAX_FINDINGS);
    if (error) throw new Error(error.message);

    const approvedVideoIds = await listApprovedSourceVideoIds(context.supabase, context.userId);
    const rows = (findings ?? []).filter(
      (r) => !isApprovedSourceVideo(approvedVideoIds, { url: r.video_url as string | null }),
    );
    const urls = Array.from(new Set(rows.map((r) => r.video_url).filter(Boolean))) as string[];

    const caseByUrl = new Map<
      string,
      { status: string | null; eligibilityStatus: string | null; basis: string | null }
    >();
    if (urls.length > 0) {
      const { data: cases } = await context.supabase
        .from("enforcement_cases")
        .select("target_url, status, eligibility_status, enforcement_basis, created_at")
        .eq("user_id", context.userId)
        .in("target_url", urls)
        .order("created_at", { ascending: false });
      for (const c of cases ?? []) {
        if (!c.target_url || caseByUrl.has(c.target_url)) continue;
        caseByUrl.set(c.target_url, {
          status: c.status ?? null,
          eligibilityStatus: c.eligibility_status ?? null,
          basis: c.enforcement_basis ?? null,
        });
      }
    }

    const inputs: InboxFindingInput[] = rows.map((r) => ({
      id: r.id as string,
      url: (r.video_url as string) ?? "",
      title: r.title ?? null,
      channelTitle: r.channel_title ?? null,
      channelUrl: r.channel_url ?? null,
      thumbnailUrl: r.thumbnail_url ?? null,
      publishedAt: r.published_at ?? null,
      subjectStatus: r.subject_status ?? null,
      subjectConfidence: r.subject_confidence ?? null,
      channelClass: r.channel_class ?? null,
      riskLevel: r.risk_level ?? null,
      removalPotential: r.removal_potential ?? null,
      recommendedAction: r.recommended_action ?? null,
      potentialViolation: r.potential_violation ?? null,
      assessmentReason: r.assessment_reason ?? null,
      evidenceVerified: r.evidence_verified ?? null,
      transcriptState: r.transcript_state ?? null,
      priorityScore: r.priority_score ?? null,
      enforcementCase: caseByUrl.get(r.video_url as string) ?? null,
    }));

    const { items, summary } = buildProtectionInbox(inputs);

    return {
      discovery: {
        lastScanAt: (latest?.updated_at as string) ?? (latest?.created_at as string) ?? null,
        status: (latest?.status as string) ?? null,
        running: ["queued", "running"].includes(String(latest?.status ?? "")),
        targetName: (latest?.target_name as string) ?? null,
      },
      items,
      removals,
      summary: {
        ...summary,
        removalsInProgress: removals.filter((r) => r.status === "Sent").length,
      },
    };

  });
