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
import { buildProtectionInbox, type InboxFindingInput } from "./inbox";

const MAX_FINDINGS = 150;

export const getProtectionInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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
        summary: { analyzed: 0, possibleRemoval: 0, needsReview: 0, monitoring: 0 },
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

    const rows = findings ?? [];
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
      summary,
    };
  });
