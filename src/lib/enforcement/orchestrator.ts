/**
 * AutoEnforcementOrchestrator Backend Service.
 * Listens for newly verified findings, evaluates eligibility, resolves authorization & routes,
 * creates enforcement cases, and enqueues durable background jobs.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { EnforcementRouter } from "./router";
import { EnforcementBasis } from "./connectors/registry";

export interface FindingShape {
  id: string;
  user_id?: string;
  source: string;
  source_type?: string | null;
  permalink?: string | null;
  canonical_url?: string | null;
  title?: string | null;
  risk_type?: string | null;
  severity?: string | null;
  threat_score?: number | null;
  protected_asset_id?: string | null;
  source_metadata?: Record<string, unknown> | null;
}

export interface EligibilityResult {
  status: "AUTO_ELIGIBLE" | "REVIEW_REQUIRED" | "NOT_ELIGIBLE";
  basis: EnforcementBasis;
  reason: {
    clientVerified: boolean;
    authorizationActive: boolean;
    scopeGranted: boolean;
    copyrightAssetVerified: boolean;
    policySetting: string;
    details: string;
  };
}

export class AutoEnforcementOrchestrator {
  /** Generate unique idempotency key per client + URL + basis + asset */
  static generateIdempotencyKey(
    userId: string,
    targetUrl: string,
    basis: string,
    protectedAssetId?: string | null
  ): string {
    const raw = `${userId}:${targetUrl.toLowerCase().trim()}:${basis}:${protectedAssetId || "default"}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  /** Evaluate eligibility of a finding based on authorization, rights ownership, policies, and scope */
  static async evaluateEligibility(
    supabase: SupabaseClient,
    userId: string,
    finding: FindingShape
  ): Promise<EligibilityResult> {
    const basis = EnforcementRouter.determineEnforcementBasis(
      finding.risk_type ?? null,
      finding.source_type ?? finding.source
    );

    // 1. Fetch Client Authorization & Profiles
    const [{ data: auth }, { data: settings }] = await Promise.all([
      supabase
        .from("client_authorizations")
        .select("id, status, enforcement_enabled, expiry_date")
        .eq("user_id", userId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("client_enforcement_settings")
        .select("automatic_enforcement_enabled, enforcement_basis_policies")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    const isAuthActive = auth?.status === "ACTIVE" && auth.enforcement_enabled !== false;

    // 2. Fetch Granted Scopes
    let scopeGranted = true;
    if (auth?.id) {
      const { data: scopes } = await supabase
        .from("authorization_scopes")
        .select("scope_key, granted")
        .eq("authorization_id", auth.id);

      const scopeMap = new Map((scopes || []).map((s) => [s.scope_key, s.granted]));
      if (basis === "COPYRIGHT" && !scopeMap.get("prepare_copyright")) scopeGranted = false;
      if (basis === "IMPERSONATION" && !scopeMap.get("prepare_impersonation")) scopeGranted = false;
      if (basis === "PRIVACY" && !scopeMap.get("prepare_privacy")) scopeGranted = false;
    }

    // 3. Category Automation Policy
    const defaultPolicies: Record<string, string> = {
      copyright: "AUTO",
      impersonation: "AUTO",
      deepfake: "AUTO",
      privacy: "REVIEW",
      harassment: "REVIEW",
      legal_escalation: "MANUAL",
    };
    const userPolicies = (settings?.enforcement_basis_policies || defaultPolicies) as Record<string, string>;
    const catKey = basis.toLowerCase().includes("copyright")
      ? "copyright"
      : basis.toLowerCase();
    const policySetting = userPolicies[catKey] || "AUTO";

    // 4. COPYRIGHT Rights & Ownership Gate
    let copyrightAssetVerified = true;
    if (basis === "COPYRIGHT" || basis === "WEBSITE_COPYRIGHT") {
      const { data: assets } = await supabase
        .from("digital_assets")
        .select("id, verification_status")
        .eq("user_id", userId)
        .eq("verification_status", "VERIFIED");

      const hasVerifiedAssets = (assets ?? []).length > 0;
      copyrightAssetVerified = hasVerifiedAssets;

      // If client merely appears in footage without copyright ownership, flag for review
      const meta = (finding.source_metadata || {}) as Record<string, unknown>;
      if (meta.third_party_footage === true || meta.ownership_uncertain === true) {
        copyrightAssetVerified = false;
      }
    }

    // Determine Final Decision
    if (!isAuthActive) {
      return {
        status: "NOT_ELIGIBLE",
        basis,
        reason: {
          clientVerified: false,
          authorizationActive: false,
          scopeGranted,
          copyrightAssetVerified,
          policySetting,
          details: "Client authorization is inactive, expired, or pending signed agreement.",
        },
      };
    }

    if (!scopeGranted) {
      return {
        status: "NOT_ELIGIBLE",
        basis,
        reason: {
          clientVerified: true,
          authorizationActive: true,
          scopeGranted: false,
          copyrightAssetVerified,
          policySetting,
          details: `Client has not granted scope authorization for ${basis} enforcement actions.`,
        },
      };
    }

    if (!copyrightAssetVerified && (basis === "COPYRIGHT" || basis === "WEBSITE_COPYRIGHT")) {
      return {
        status: "REVIEW_REQUIRED",
        basis,
        reason: {
          clientVerified: true,
          authorizationActive: true,
          scopeGranted: true,
          copyrightAssetVerified: false,
          policySetting,
          details: "Copyright ownership of original work is unknown or involves third-party/public footage.",
        },
      };
    }

    if (policySetting === "REVIEW") {
      return {
        status: "REVIEW_REQUIRED",
        basis,
        reason: {
          clientVerified: true,
          authorizationActive: true,
          scopeGranted: true,
          copyrightAssetVerified,
          policySetting,
          details: `Client configuration requires manual operator review for ${basis} enforcement.`,
        },
      };
    }

    if (policySetting === "MANUAL" || policySetting === "OFF") {
      return {
        status: "NOT_ELIGIBLE",
        basis,
        reason: {
          clientVerified: true,
          authorizationActive: true,
          scopeGranted: true,
          copyrightAssetVerified,
          policySetting,
          details: `Automated enforcement for ${basis} is set to MANUAL/OFF in client settings.`,
        },
      };
    }

    return {
      status: "AUTO_ELIGIBLE",
      basis,
      reason: {
        clientVerified: true,
        authorizationActive: true,
        scopeGranted: true,
        copyrightAssetVerified,
        policySetting,
        details: `Client verified, authorization active, copyright asset verified, target route available.`,
      },
    };
  }

  /** Entry point when a scanner discovers a verified finding */
  static async onVerifiedFinding(
    supabase: SupabaseClient,
    userId: string,
    finding: FindingShape
  ): Promise<{ caseId: string | null; status: string; idempotencyDeduplicated: boolean }> {
    const targetUrl = finding.canonical_url || finding.permalink;
    if (!targetUrl) return { caseId: null, status: "SKIPPED_NO_URL", idempotencyDeduplicated: false };

    const eligibility = await this.evaluateEligibility(supabase, userId, finding);
    const idempotencyKey = this.generateIdempotencyKey(
      userId,
      targetUrl,
      eligibility.basis,
      finding.protected_asset_id
    );

    // Check Idempotency Guard to prevent duplicate active complaints
    const { data: existingCase } = await supabase
      .from("enforcement_cases")
      .select("id, status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingCase) {
      return {
        caseId: existingCase.id,
        status: existingCase.status,
        idempotencyDeduplicated: true,
      };
    }

    // Resolve Route and Connector
    const route = await EnforcementRouter.resolveRoute(targetUrl, eligibility.basis);

    // Insert Enforcement Case
    const initialStatus =
      eligibility.status === "AUTO_ELIGIBLE"
        ? "QUEUED"
        : eligibility.status === "REVIEW_REQUIRED"
        ? "UNDER_REVIEW"
        : "NOT_ELIGIBLE";

    // Findings arrive from several engines (scan hits, deepfake intel, discovery).
    // scan_hit_id is a FK into scan_hits, so only set it for real scan hits.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      finding.id ?? "",
    );
    const scanHitId = isUuid
      ? (
          await supabase.from("scan_hits").select("id").eq("id", finding.id).maybeSingle()
        ).data?.id ?? null
      : null;

    const { data: createdCase, error: caseErr } = await supabase
      .from("enforcement_cases")
      .insert({
        user_id: userId,
        scan_hit_id: scanHitId,
        protected_asset_id: finding.protected_asset_id || null,
        target_url: targetUrl,
        domain: route.domain,
        platform: finding.source_type || finding.source,
        enforcement_basis: eligibility.basis,
        eligibility_status: eligibility.status,
        eligibility_reason: eligibility.reason as never,
        authorization_status: eligibility.reason.authorizationActive ? "VERIFIED" : "UNVERIFIED",
        selected_route: route.connector.name,
        connector_id: route.connector.id,
        status: initialStatus,
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();

    if (caseErr || !createdCase) {
      console.error("[AutoEnforcementOrchestrator] failed to create case", caseErr);
      throw caseErr ?? new Error("Failed to create enforcement case");
    }

    const caseId = createdCase.id;

    // Log Audit Events
    await supabase.from("enforcement_events").insert([
      {
        case_id: caseId,
        user_id: userId,
        event_type: "FINDING_RECEIVED",
        actor_type: "SYSTEM",
        metadata: { target_url: targetUrl, source: finding.source },
      },
      {
        case_id: caseId,
        user_id: userId,
        event_type: "ELIGIBILITY_STARTED",
        actor_type: "SYSTEM",
        metadata: { basis: eligibility.basis },
      },
      {
        case_id: caseId,
        user_id: userId,
        event_type: eligibility.status,
        actor_type: "SYSTEM",
        new_state: initialStatus,
        metadata: eligibility.reason as never,
      },
    ]);

    // Handle Review Required
    if (eligibility.status === "REVIEW_REQUIRED") {
      await supabase.from("enforcement_review_queue").insert({
        case_id: caseId,
        user_id: userId,
        reason: eligibility.reason.details,
        review_status: "PENDING",
      });
      return { caseId, status: "UNDER_REVIEW", idempotencyDeduplicated: false };
    }

    // Handle Auto Eligible -> Enqueue Job
    if (eligibility.status === "AUTO_ELIGIBLE") {
      await supabase.from("enforcement_jobs").insert({
        case_id: caseId,
        user_id: userId,
        job_type: "AUTO_ENFORCEMENT_SUBMIT",
        payload: {
          targetUrl,
          domain: route.domain,
          connectorId: route.connector.id,
          enforcementBasis: eligibility.basis,
        },
        status: "queued",
      });
    }

    return { caseId, status: initialStatus, idempotencyDeduplicated: false };
  }
}
