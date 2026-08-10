/**
 * Phase 1 Enforcement Router.
 * Resolves domains, matches legal bases to connectors, and verifies route destination status.
 */

import { connectorRegistry, EnforcementBasis, EnforcementConnector } from "./connectors/registry";
import "./connectors/platform-connectors";

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

    // 1. YouTube specialized route
    if (domain.includes("youtube.com") || domain.includes("youtu.be")) {
      const connector = connectorRegistry.get("youtube_copyright_connector")!;
      return {
        domain,
        enforcementBasis: "COPYRIGHT",
        connector,
        submissionMethod: connector.submissionMethod,
        destinationRouteStatus: "VERIFIED",
        reportingUrl: "https://www.youtube.com/copyright_complaint_form",
        requiresHuman: true,
      };
    }

    // 2. Search engine delisting route
    if (enforcementBasis === "SEARCH_ENGINE_COPYRIGHT") {
      const connector = connectorRegistry.get("google_search_delist_connector")!;
      return {
        domain,
        enforcementBasis,
        connector,
        submissionMethod: connector.submissionMethod,
        destinationRouteStatus: "VERIFIED",
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
        destinationEmail: domainIntel?.abuseEmail || `abuse@${domain}`,
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
      destinationEmail: domainIntel?.copyrightEmail || domainIntel?.abuseEmail || `dmca@${domain}`,
      destinationRouteStatus: domainIntel?.copyrightEmail ? verificationStatus : "DISCOVERED_UNVERIFIED",
      reportingUrl: domainIntel?.reportingUrl,
      requiresHuman: domainIntel?.requiresHuman ?? false,
    };
  }
}
