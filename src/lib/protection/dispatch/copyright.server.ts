/**
 * Copyright Intelligence dispatch. Automatically enrolls every active
 * protected_assets row (the real, durable, customer-linked media library —
 * confirmed to already exist; this wires it as an input, it does not build
 * a second media system) into the same production pipeline the manual
 * "Copyright Intel" page uses (executeCopyrightScanById — already runs
 * headlessly today, since it's the same function the HMAC webhook calls).
 */
import { AutoEnforcementOrchestrator, type FindingShape } from "@/lib/enforcement/orchestrator";
import { captureAndRecordFindingEvidence } from "@/lib/protection/evidence.server";

export interface CopyrightOutcome {
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

const MAX_ASSETS_PER_TICK = 5;

export interface ProtectedAssetLike {
  id: string;
  name: string;
  storage_path: string | null;
}

/**
 * Pure selection logic, split out from the DB/pipeline calls so it's
 * directly unit-testable: which of this customer's active protected assets
 * are due for a copyright scan right now, given each asset's most recent
 * scan timestamp (or null if never scanned) and the module's cadence.
 * Bounded to MAX_ASSETS_PER_TICK so one customer with many assets can't
 * starve a single orchestrator tick.
 */
export function selectDueAssets(
  assets: ProtectedAssetLike[],
  lastScanAtByAssetId: Map<string, string | null>,
  cadenceMinutes: number,
  now: Date = new Date(),
): ProtectedAssetLike[] {
  const cutoffIso = new Date(now.getTime() - cadenceMinutes * 60_000).toISOString();
  const due: ProtectedAssetLike[] = [];
  for (const asset of assets) {
    if (!asset.storage_path) continue;
    const lastScanAt = lastScanAtByAssetId.get(asset.id) ?? null;
    if (!lastScanAt || lastScanAt < cutoffIso) {
      due.push(asset);
    }
    if (due.length >= MAX_ASSETS_PER_TICK) break;
  }
  return due;
}

export interface CopyrightDispatchDeps {
  executeCopyrightScanById?: (input: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    scanId: string;
    source: "inline" | "worker";
  }) => Promise<unknown>;

  captureEvidence?: typeof captureAndRecordFindingEvidence;
  onVerifiedFinding?: typeof AutoEnforcementOrchestrator.onVerifiedFinding;
}

export async function runCopyrightIntelForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  cadenceMinutes: number,
  deps: CopyrightDispatchDeps = {},
): Promise<CopyrightOutcome> {
  const { data: assets } = await supabaseAdmin
    .from("protected_assets")
    .select("id, name, storage_path, active")
    .eq("user_id", userId)
    .eq("active", true);
  const eligible: ProtectedAssetLike[] = assets ?? [];

  if (eligible.filter((a) => !!a.storage_path).length === 0) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_ELIGIBLE_ASSETS",
    };
  }

  const lastScanAtByAssetId = new Map<string, string | null>();
  for (const asset of eligible) {
    const { data: lastScan } = await supabaseAdmin
      .from("copyright_scans")
      .select("created_at")
      .eq("protected_asset_id", asset.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastScanAtByAssetId.set(asset.id, lastScan?.created_at ?? null);
  }
  const due = selectDueAssets(eligible, lastScanAtByAssetId, cadenceMinutes);

  if (due.length === 0) {
    return { status: "COMPLETED", candidates_found: 0, verified_findings: 0, blocked_reason: null };
  }

  let totalCandidates = 0;
  let totalVerified = 0;
  let anyFailed = false;
  let lastError: string | null = null;

  for (const asset of due) {
    try {
      const { data: scan, error: insertErr } = await supabaseAdmin
        .from("copyright_scans")
        .insert({
          user_id: userId,
          title: asset.name,
          reference_kind: "image",
          storage_path: asset.storage_path,
          protected_asset_id: asset.id,
          status: "running",
        })
        .select("id")
        .single();
      if (insertErr || !scan)
        throw new Error(insertErr?.message ?? "Failed to create copyright scan");

      const executeCopyrightScanById =
        deps.executeCopyrightScanById ??
        (await import("@/lib/copyright/scan-executor.server")).executeCopyrightScanById;
      await executeCopyrightScanById({
        supabase: supabaseAdmin,
        scanId: scan.id,
        source: "worker",
      });

      const { data: matches } = await supabaseAdmin
        .from("copyright_matches")
        .select("id, source_url, page_title, confidence_band, review_status")
        .eq("scan_id", scan.id);
      const rows = matches ?? [];
      totalCandidates += rows.length;

      const qualifying = rows.filter(
        (m: { confidence_band: string; review_status: string }) =>
          m.confidence_band === "confirmed" && m.review_status !== "rejected",
      );
      totalVerified += qualifying.length;

      const captureEvidence = deps.captureEvidence ?? captureAndRecordFindingEvidence;
      const onVerifiedFinding =
        deps.onVerifiedFinding ?? AutoEnforcementOrchestrator.onVerifiedFinding;

      for (const match of qualifying) {
        try {
          const evidence = await captureEvidence(supabaseAdmin, {
            userId,
            moduleKey: "copyright_intel",
            findingSourceTable: "copyright_matches",
            findingId: match.id as string,
            url: match.source_url as string,
            title: (match.page_title as string) ?? undefined,
            mediaType: "image",
          });
          if (evidence.status === "capture_failed") continue;

          const finding: FindingShape = {
            id: match.id as string,
            source: "copyright_intel",
            source_type: "copyright",
            canonical_url: match.source_url as string,
            protected_asset_id: asset.id,
            risk_type: "COPYRIGHT",
          };
          await onVerifiedFinding(supabaseAdmin, userId, finding);
        } catch (err) {
          console.error("[protection:copyright] case prep failed", match.id, err);
        }
      }
    } catch (err) {
      // One asset's failure (provider quota, transient error) must not stop
      // the rest of this tick's batch.
      anyFailed = true;
      lastError = (err as Error).message?.slice(0, 200) ?? "ASSET_SCAN_FAILED";
      console.error("[protection:copyright] asset scan failed", asset.id, err);
    }
  }

  return {
    status: anyFailed ? "PARTIAL" : "COMPLETED",
    candidates_found: totalCandidates,
    verified_findings: totalVerified,
    blocked_reason: anyFailed ? lastError : null,
  };
}
