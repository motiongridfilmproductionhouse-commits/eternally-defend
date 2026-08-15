/**
 * Removal Route Management — operator server functions.
 *
 * Verification is an admin-only action and always requires authoritative
 * evidence. Nothing here sends a notice or touches the live kill switch.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  decidePlatformRoute,
  effectiveRouteState,
  evaluateVerification,
  isGuessedAddress,
  nextReverifyDueAt,
  type RemovalRouteType,
} from "./removal-route-policy";

export interface RemovalRouteView {
  id: string;
  domain: string;
  routeType: string;
  platformKind: string | null;
  recipientEmail: string | null;
  status: string;
  effectiveStatus: string;
  verificationMethod: string | null;
  authoritativeSourceUrl: string | null;
  evidenceSnapshot: { excerpt?: string; operator_note?: string; recorded_at?: string };
  verifiedAt: string | null;
  verifiedBy: string | null;
  lastCheckedAt: string | null;
  reverifyDueAt: string | null;
  rejectedReason: string | null;
  hostingProvider: string | null;
  notes: string | null;
  isGuessedCandidate: boolean;
  canAutoSend: boolean;
  createdAt: string | null;
}

async function isOperator(ctx: { supabase: any; userId: string }): Promise<boolean> {
  const [admin, superAdmin] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "super_admin" }),
  ]);
  return Boolean(admin?.data) || Boolean(superAdmin?.data);
}

function toView(r: any): RemovalRouteView {
  const state = effectiveRouteState(r);
  const recipient = state.recipientEmail;
  return {
    id: r.id,
    domain: r.domain,
    routeType: r.route_type ?? "EMAIL_DMCA",
    platformKind: r.platform_kind ?? null,
    recipientEmail: recipient,
    status: r.verification_status ?? "DISCOVERED_UNVERIFIED",
    effectiveStatus: state.status,
    verificationMethod: r.verification_method ?? null,
    authoritativeSourceUrl: r.authoritative_source_url ?? r.source_url ?? null,
    evidenceSnapshot: (r.evidence_snapshot ?? {}) as RemovalRouteView["evidenceSnapshot"],
    verifiedAt: r.verified_at ?? null,
    verifiedBy: r.verified_by ?? null,
    lastCheckedAt: r.last_checked_at ?? null,
    reverifyDueAt: r.reverify_due_at ?? null,
    rejectedReason: r.rejected_reason ?? null,
    hostingProvider: r.hosting_provider ?? null,
    notes: r.notes ?? null,
    isGuessedCandidate: recipient ? isGuessedAddress(recipient, r.domain) : false,
    canAutoSend: state.canAutoSend,
    createdAt: r.created_at ?? null,
  };
}

/** Operator listing of every removal route with its derived state. */
export const listRemovalRoutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const operator = await isOperator(context as any);
    const { data, error } = await (context as any).supabase
      .from("domain_enforcement_routes")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return {
      isOperator: operator,
      routes: ((data ?? []) as any[]).map(toView),
    };
  });

/** Classify a target URL without storing anything — used by the operator UI. */
export const previewRemovalRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { targetUrl: string }) => d)
  .handler(async ({ data }) => {
    const decision = decidePlatformRoute(data.targetUrl);
    return { ...decision };
  });

/** Record a candidate route for operator review. Never VERIFIED. */
export const recordCandidateRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { domain: string; recipientEmail?: string; sourceUrl?: string }) => d)
  .handler(async ({ data, context }) => {
    const domain = data.domain.trim().toLowerCase().replace(/^www\./, "");
    const candidate = (data.recipientEmail ?? `dmca@${domain}`).trim().toLowerCase();
    const { error } = await (context as any).supabase.from("domain_enforcement_routes").upsert(
      {
        domain,
        route_type: "EMAIL_DMCA",
        recipient_email: candidate,
        contact: candidate,
        verification_status: "DISCOVERED_UNVERIFIED",
        verification_method: "HEURISTIC_DISCOVERY",
        source_url: data.sourceUrl ?? null,
        confidence: 0.3,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "domain", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return { ok: true, domain, status: "DISCOVERED_UNVERIFIED" as const };
  });

export interface VerifyRouteInput {
  domain: string;
  recipientEmail: string;
  routeType?: RemovalRouteType;
  verificationMethod: string;
  authoritativeSourceUrl: string;
  evidenceExcerpt?: string;
  operatorNote?: string;
  contactType?: "COPYRIGHT" | "ABUSE" | "LEGAL";
  hostingProvider?: string;
}

/**
 * Promote a route to VERIFIED. Admin-only, evidence-gated, idempotent.
 */
export const verifyRemovalRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: VerifyRouteInput) => d)
  .handler(async ({ data, context }) => {
    const operator = await isOperator(context as any);
    const domain = data.domain.trim().toLowerCase().replace(/^www\./, "");
    const recipient = data.recipientEmail.trim().toLowerCase();
    const routeType = data.routeType ?? "EMAIL_DMCA";

    const decision = evaluateVerification({
      domain,
      recipientEmail: recipient,
      routeType,
      verificationMethod: data.verificationMethod,
      authoritativeSourceUrl: data.authoritativeSourceUrl,
      evidenceSnapshot: {
        ...(data.evidenceExcerpt ? { excerpt: data.evidenceExcerpt } : {}),
        ...(data.operatorNote ? { operator_note: data.operatorNote } : {}),
      },
      actorIsOperator: operator,
    });

    if (!decision.canVerify) {
      return {
        ok: false as const,
        status: decision.fallbackStatus,
        issues: decision.issues,
      };
    }

    const now = new Date();
    const { error } = await (context as any).supabase
      .from("domain_enforcement_routes")
      .upsert(
        {
          domain,
          route_type: routeType,
          recipient_email: recipient,
          contact: recipient,
          copyright_email: data.contactType === "ABUSE" ? null : recipient,
          abuse_email: data.contactType === "ABUSE" ? recipient : null,
          contact_type: data.contactType ?? "COPYRIGHT",
          preferred_method: "EMAIL",
          verification_status: "VERIFIED",
          verification_method: data.verificationMethod.trim().toUpperCase(),
          authoritative_source_url: data.authoritativeSourceUrl.trim(),
          source_url: data.authoritativeSourceUrl.trim(),
          evidence_snapshot: {
            ...(data.evidenceExcerpt ? { excerpt: data.evidenceExcerpt } : {}),
            ...(data.operatorNote ? { operator_note: data.operatorNote } : {}),
            recorded_at: now.toISOString(),
          },
          hosting_provider: data.hostingProvider ?? null,
          confidence: 1,
          verified_at: now.toISOString(),
          verified_by: (context as any).userId,
          last_checked_at: now.toISOString(),
          reverify_due_at: nextReverifyDueAt(now),
          rejected_reason: null,
          updated_at: now.toISOString(),
        },
        { onConflict: "domain" },
      );
    if (error) throw new Error(error.message);

    return { ok: true as const, status: "VERIFIED" as const, domain, recipient };
  });

/** Reject or mark a route stale. Admin-only. */
export const setRemovalRouteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { domain: string; status: "REJECTED" | "STALE" | "MANUAL_REVIEW"; reason?: string }) => d)
  .handler(async ({ data, context }) => {
    const operator = await isOperator(context as any);
    if (!operator) {
      return { ok: false as const, issues: ["Only an admin/operator may change a removal route status."] };
    }
    const domain = data.domain.trim().toLowerCase().replace(/^www\./, "");
    const { error } = await (context as any).supabase
      .from("domain_enforcement_routes")
      .update({
        verification_status: data.status,
        rejected_reason: data.status === "REJECTED" ? (data.reason ?? "Rejected by operator") : null,
        notes: data.reason ?? null,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("domain", domain);
    if (error) throw new Error(error.message);
    return { ok: true as const, domain, status: data.status };
  });
