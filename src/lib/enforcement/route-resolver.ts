/**
 * Automated Enforcement Route Resolver & Host Identification Engine.
 *
 * Responsibilities:
 *  - Explicit platform routing (known social/UGC/marketplace/search hosts never
 *    fall through to a guessed generic email).
 *  - CDN/proxy detection -> HOST_ORIGIN_DISCOVERY_REQUIRED (the CDN is never the
 *    recipient).
 *  - Independent websites -> EMAIL_DMCA, but only when the stored route has been
 *    authoritatively verified by an operator.
 *  - Recording discovered candidates as DISCOVERED_UNVERIFIED for operator review.
 *
 * This module never promotes a route to VERIFIED and never sends anything.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { EnforcementRouter } from "./router";
import {
  decidePlatformRoute,
  effectiveRouteState,
  isGuessedAddress,
  type RemovalRouteType,
} from "./removal-route-policy";

export type RouteVerificationStatus =
  | "VERIFIED"
  | "DISCOVERED_UNVERIFIED"
  | "MANUAL_REVIEW"
  | "REJECTED"
  | "INVALID"
  | "STALE"
  | "HOST_ORIGIN_UNKNOWN";

export interface ResolvedEnforcementRoute {
  domain: string;
  contactEmail?: string | null;
  contactType: "COPYRIGHT" | "ABUSE" | "LEGAL";
  submissionMethod: "EMAIL" | "HUMAN_REQUIRED" | "FORM";
  routeType: RemovalRouteType;
  platformLabel?: string;
  platformKind?: string;
  connectorId?: string | null;
  preparePackage?: boolean;
  verificationStatus: RouteVerificationStatus;
  verificationMethod: string;
  sourceUrl?: string | null;
  hostingProvider?: string | null;
  registrar?: string | null;
  confidence: number;
  isStale: boolean;
  canAutoSend: boolean;
  notes?: string;
}

export class EnforcementRouteResolver {
  static STALE_THRESHOLD_DAYS = 90;

  static async resolveRoute(
    supabase: SupabaseClient,
    targetUrl: string,
    enforcementBasis: string = "COPYRIGHT",
  ): Promise<ResolvedEnforcementRoute> {
    const domain = EnforcementRouter.extractDomain(targetUrl);
    const platform = decidePlatformRoute(targetUrl);

    // 1. Explicit non-email platform routing. Known platforms, search surfaces
    //    and CDN/proxy hosts are resolved here and never reach email discovery.
    if (platform.routeType !== "EMAIL_DMCA") {
      const isCdn = platform.routeType === "HOST_ORIGIN_DISCOVERY_REQUIRED";
      return {
        domain,
        contactEmail: null,
        contactType: isCdn ? "ABUSE" : "COPYRIGHT",
        submissionMethod: "HUMAN_REQUIRED",
        routeType: platform.routeType,
        platformLabel: platform.platformLabel,
        platformKind: platform.platformKind,
        connectorId: platform.connectorId,
        preparePackage: platform.preparePackage,
        verificationStatus: isCdn ? "HOST_ORIGIN_UNKNOWN" : "VERIFIED",
        verificationMethod: isCdn ? "CDN_PROXY_DETECTED" : "PLATFORM_POLICY_DOCUMENTED",
        hostingProvider: isCdn ? platform.platformLabel : null,
        confidence: isCdn ? 0.5 : 1,
        isStale: false,
        canAutoSend: false,
        notes: platform.reason,
      };
    }

    // 2. Independent website: consult the operator-managed route registry.
    const { data: dbRoute } = await (supabase as any)
      .from("domain_enforcement_routes")
      .select("*")
      .eq("domain", domain)
      .maybeSingle();

    if (dbRoute) {
      const state = effectiveRouteState(dbRoute);
      return {
        domain,
        contactEmail: state.recipientEmail,
        contactType: (dbRoute.contact_type as any) || "COPYRIGHT",
        submissionMethod: state.canAutoSend ? "EMAIL" : "HUMAN_REQUIRED",
        routeType: (dbRoute.route_type as RemovalRouteType) || "EMAIL_DMCA",
        platformLabel: platform.platformLabel,
        platformKind: platform.platformKind,
        connectorId: platform.connectorId,
        preparePackage: false,
        verificationStatus: state.status as RouteVerificationStatus,
        verificationMethod: dbRoute.verification_method || "SYSTEM_DATABASE",
        sourceUrl: dbRoute.authoritative_source_url || dbRoute.source_url,
        hostingProvider: dbRoute.hosting_provider ?? null,
        registrar: dbRoute.registrar ?? null,
        confidence: dbRoute.confidence ?? 1,
        isStale: state.isStale,
        canAutoSend: state.canAutoSend,
        notes: state.reason,
      };
    }

    // 3. No stored route: record a review candidate, stay unverified.
    return this.recordDiscoveryCandidate(supabase, domain, targetUrl, platform);
  }

  private static async recordDiscoveryCandidate(
    supabase: SupabaseClient,
    domain: string,
    targetUrl: string,
    platform: ReturnType<typeof decidePlatformRoute>,
  ): Promise<ResolvedEnforcementRoute> {
    const candidateEmail = `dmca@${domain}`;
    const guessed = isGuessedAddress(candidateEmail, domain);

    await (supabase as any).from("domain_enforcement_routes").upsert(
      {
        domain,
        route_type: "EMAIL_DMCA",
        platform_kind: platform.platformKind,
        recipient_email: candidateEmail,
        copyright_email: candidateEmail,
        contact: candidateEmail,
        verification_status: "DISCOVERED_UNVERIFIED",
        verification_method: "HEURISTIC_DISCOVERY",
        source_url: targetUrl,
        confidence: 0.3,
        last_checked_at: new Date().toISOString(),
        notes: guessed
          ? "Pattern-guessed candidate mailbox. Requires authoritative operator verification before any send."
          : "Discovered candidate. Requires authoritative operator verification before any send.",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "domain", ignoreDuplicates: true },
    );

    return {
      domain,
      contactEmail: candidateEmail,
      contactType: "COPYRIGHT",
      submissionMethod: "HUMAN_REQUIRED",
      routeType: "EMAIL_DMCA",
      platformLabel: platform.platformLabel,
      platformKind: platform.platformKind,
      connectorId: platform.connectorId,
      preparePackage: false,
      verificationStatus: "DISCOVERED_UNVERIFIED",
      verificationMethod: "HEURISTIC_DISCOVERY",
      confidence: 0.3,
      isStale: false,
      canAutoSend: false,
      notes: `Guessed candidate (${candidateEmail}) queued for operator route verification. Automated sending stays blocked until an authoritative source is recorded.`,
    };
  }
}
