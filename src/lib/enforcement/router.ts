/**
 * Phase 1 Enforcement Router.
 * Resolves domains, matches legal bases to connectors, and verifies route destination status.
 */

import { connectorRegistry, EnforcementBasis, EnforcementConnector } from "./connectors/registry";
import "./connectors/platform-connectors";
import { decidePlatformRoute } from "./removal-route-policy";

export interface RouteResolution {
  domain: string;
  enforcementBasis: EnforcementBasis;
  connector: EnforcementConnector;
  submissionMethod: string;
  destinationEmail?: string | null;
  destinationRouteStatus: "VERIFIED" | "DISCOVERED_UNVERIFIED" | "MANUAL_REVIEW";
  reportingUrl?: string | null;
  requiresHuman: boolean;
}

export class EnforcementRouter {
  static extractDomain(targetUrl: string): string {
    try {
      const parsed = new URL(targetUrl);
      let host = parsed.hostname.toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);
      return host;
    } catch {
      return "unknown-domain.com";
    }
  }

  static determineEnforcementBasis(riskType: string | null, sourceType: string | null): EnforcementBasis {
    const r = (riskType || "").toUpperCase();
    const s = (sourceType || "").toUpperCase();

    if (r.includes("COPYRIGHT") || s.includes("COPYRIGHT")) return "COPYRIGHT";
    if (r.includes("IMPERSONATION") || r.includes("FAKE_ACCOUNT")) return "IMPERSONATION";
    if (r.includes("DEEPFAKE") || r.includes("SYNTHETIC")) return "DEEPFAKE";
    if (r.includes("PRIVACY") || r.includes("DOXXING")) return "PRIVACY";
    if (r.includes("NCII") || r.includes("INTIMATE")) return "NCII";
    if (r.includes("HARASSMENT") || r.includes("DEFAMATION")) return "PLATFORM_POLICY";

    return "WEBSITE_COPYRIGHT";
  }

  static async resolveRoute(
    targetUrl: string,
    enforcementBasis: EnforcementBasis,
    domainIntel?: {
      copyrightEmail?: string;
      abuseEmail?: string;
      reportingUrl?: string;
      preferredMethod?: string;
      requiresHuman?: boolean;
      verificationStatus?: string;
    }
  ): Promise<RouteResolution> {
    const domain = this.extractDomain(targetUrl);
    const verificationStatus = (domainIntel?.verificationStatus || "VERIFIED") as RouteResolution["destinationRouteStatus"];

    const platform = decidePlatformRoute(targetUrl);

    // 1. Explicit platform routing — known platforms, search surfaces and CDN
    //    hosts never fall through to a guessed generic email address.
    if (platform.routeType !== "EMAIL_DMCA") {
      const connector =
        (platform.connectorId ? connectorRegistry.get(platform.connectorId) : undefined) ??
        connectorRegistry.get("generic_human_action_connector") ??
        connectorRegistry.get("youtube_copyright_connector")!;
      return {
        domain,
        enforcementBasis:
          platform.routeType === "SEARCH_DELISTING" ? "SEARCH_ENGINE_COPYRIGHT" : enforcementBasis,
        connector,
        submissionMethod: "HUMAN_REQUIRED",
        destinationEmail: null,
        destinationRouteStatus: platform.routeType === "HOST_ORIGIN_DISCOVERY_REQUIRED" ? "MANUAL_REVIEW" : "VERIFIED",
        reportingUrl: platform.platformKind === "youtube" ? "https://www.youtube.com/copyright_complaint_form" : null,
        requiresHuman: true,
      };
    }

    // 3. Domain Intel lookup or fallback email / abuse route
    const webConnector = connectorRegistry.get("website_copyright_connector") || connectorRegistry.get("email_dmca_connector")!;
    const hostConnector = connectorRegistry.get("host_abuse_connector") || connectorRegistry.get("email_dmca_connector")!;

    if (enforcementBasis === "HOST_ESCALATION" || enforcementBasis === "NCII") {
      return {
        domain,
        enforcementBasis,
        connector: hostConnector,
        submissionMethod: hostConnector.submissionMethod,
        destinationEmail: domainIntel?.abuseEmail ?? null,
        destinationRouteStatus: domainIntel?.abuseEmail ? verificationStatus : "DISCOVERED_UNVERIFIED",
        reportingUrl: domainIntel?.reportingUrl,
        requiresHuman: domainIntel?.requiresHuman ?? false,
      };
    }

    return {
      domain,
      enforcementBasis,
      connector: webConnector,
      submissionMethod: webConnector.submissionMethod,
      destinationEmail: domainIntel?.copyrightEmail ?? domainIntel?.abuseEmail ?? null,
      destinationRouteStatus: domainIntel?.copyrightEmail ? verificationStatus : "DISCOVERED_UNVERIFIED",
      reportingUrl: domainIntel?.reportingUrl,
      requiresHuman: domainIntel?.requiresHuman ?? false,
    };
  }
}
