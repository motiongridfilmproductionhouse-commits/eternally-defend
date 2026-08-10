/**
 * Platform Connectors Implementation.
 * Truthfully classifies YouTube and Google Search as HUMAN_ACTION_REQUIRED
 * while delegating verified website copyright and host abuse cases to EmailEnforcementConnector.
 */

import {
  EnforcementConnector,
  EnforcementCasePayload,
  ConnectorValidationResult,
  ConnectorSubmissionResult,
  ConnectorStatusResult,
  connectorRegistry,
} from "./registry";
import { EmailEnforcementConnector } from "./email-connector";

export class YouTubeConnector implements EnforcementConnector {
  id = "youtube_copyright_connector";
  name = "YouTube Copyright Connector";
  platform = "YouTube";
  submissionMethod = "HUMAN_REQUIRED" as const;
  supportedBasis = ["COPYRIGHT" as const];
  requiresHuman = true;

  async validate(payload: EnforcementCasePayload): Promise<ConnectorValidationResult> {
    const issues: string[] = [];
    if (!payload.targetUrl.toLowerCase().includes("youtube") && !payload.targetUrl.toLowerCase().includes("youtu.be")) {
      issues.push("Target URL is not a valid YouTube URL");
    }
    return { ok: issues.length === 0, issues };
  }

  async prepare(payload: EnforcementCasePayload): Promise<Record<string, unknown>> {
    return {
      videoUrl: payload.targetUrl,
      basis: "COPYRIGHT",
      complainant: payload.complainantName,
      preparedPackage: "Eterna Copyright Evidence Bundle (PDF + Timestamps + Signed Auth)",
    };
  }

  async submit(payload: EnforcementCasePayload): Promise<ConnectorSubmissionResult> {
    // Truthfully report HUMAN_ACTION_REQUIRED until YouTube Enterprise Content ID API integration exists
    return {
      success: true,
      status: "HUMAN_ACTION_REQUIRED",
      trackingRef: `YT-PKG-${payload.caseId.slice(0, 8)}`,
      notes: "HUMAN SUBMISSION REQUIRED — Standard YouTube API v3 does not grant DMCA takedown submission privileges. Evidence package prepared for operator webform submission.",
    };
  }

  async checkStatus(payload: EnforcementCasePayload, currentStatus: string): Promise<ConnectorStatusResult> {
    return {
      status: (currentStatus as ConnectorStatusResult["status"]) || "UNDER_REVIEW",
      verifiedAt: new Date().toISOString(),
    };
  }

  async retry(payload: EnforcementCasePayload, attempt: number): Promise<ConnectorSubmissionResult> {
    return this.submit(payload);
  }
}

export class GoogleSearchConnector implements EnforcementConnector {
  id = "google_search_delist_connector";
  name = "Google Search Delisting Connector";
  platform = "Google";
  submissionMethod = "HUMAN_REQUIRED" as const;
  supportedBasis = ["SEARCH_ENGINE_COPYRIGHT" as const, "COPYRIGHT" as const, "PRIVACY" as const];
  requiresHuman = true;

  async validate(payload: EnforcementCasePayload): Promise<ConnectorValidationResult> {
    return { ok: true, issues: [] };
  }

  async prepare(payload: EnforcementCasePayload): Promise<Record<string, unknown>> {
    return { targetUrl: payload.targetUrl, searchEngine: "Google" };
  }

  async submit(payload: EnforcementCasePayload): Promise<ConnectorSubmissionResult> {
    // Truthfully report HUMAN_ACTION_REQUIRED until authorized Search Console API integration exists
    return {
      success: true,
      status: "HUMAN_ACTION_REQUIRED",
      trackingRef: `GGL-PKG-${payload.caseId.slice(0, 8)}`,
      notes: "HUMAN SUBMISSION REQUIRED — No official public Google Search DMCA REST API exists. Evidence package prepared for manual Google Search Console delisting request.",
    };
  }

  async checkStatus(payload: EnforcementCasePayload, currentStatus: string): Promise<ConnectorStatusResult> {
    return {
      status: (currentStatus as ConnectorStatusResult["status"]) || "UNDER_REVIEW",
      verifiedAt: new Date().toISOString(),
    };
  }

  async retry(payload: EnforcementCasePayload, attempt: number): Promise<ConnectorSubmissionResult> {
    return this.submit(payload);
  }
}

export class WebsiteCopyrightConnector implements EnforcementConnector {
  id = "website_copyright_connector";
  name = "Website Copyright Email Connector";
  platform = "Web";
  submissionMethod = "EMAIL" as const;
  supportedBasis = ["WEBSITE_COPYRIGHT" as const, "COPYRIGHT" as const];
  private emailConnector = new EmailEnforcementConnector();

  async validate(payload: EnforcementCasePayload): Promise<ConnectorValidationResult> {
    return this.emailConnector.validate(payload);
  }

  async prepare(payload: EnforcementCasePayload): Promise<Record<string, unknown>> {
    return this.emailConnector.prepare(payload);
  }

  async submit(payload: EnforcementCasePayload): Promise<ConnectorSubmissionResult> {
    // Check destination route status before delegating
    if (payload.destinationRouteStatus && payload.destinationRouteStatus !== "VERIFIED") {
      return {
        success: false,
        status: "ROUTE_DISCOVERY_REQUIRED",
        error: `Website copyright route for domain ${payload.domain} is unverified (${payload.destinationRouteStatus}). Delivery halted.`,
      };
    }
    return this.emailConnector.submit(payload);
  }

  async checkStatus(payload: EnforcementCasePayload, currentStatus: string): Promise<ConnectorStatusResult> {
    return this.emailConnector.checkStatus(payload, currentStatus);
  }

  async retry(payload: EnforcementCasePayload, attempt: number): Promise<ConnectorSubmissionResult> {
    return this.submit(payload);
  }
}

export class HostAbuseConnector implements EnforcementConnector {
  id = "host_abuse_connector";
  name = "Hosting Provider Abuse Connector";
  platform = "Host";
  submissionMethod = "EMAIL" as const;
  supportedBasis = ["HOST_ESCALATION" as const, "WEBSITE_COPYRIGHT" as const, "NCII" as const];
  private emailConnector = new EmailEnforcementConnector();

  async validate(payload: EnforcementCasePayload): Promise<ConnectorValidationResult> {
    return this.emailConnector.validate(payload);
  }

  async prepare(payload: EnforcementCasePayload): Promise<Record<string, unknown>> {
    return this.emailConnector.prepare(payload);
  }

  async submit(payload: EnforcementCasePayload): Promise<ConnectorSubmissionResult> {
    if (payload.destinationRouteStatus && payload.destinationRouteStatus !== "VERIFIED") {
      return {
        success: false,
        status: "ROUTE_DISCOVERY_REQUIRED",
        error: `Hosting provider abuse destination for ${payload.domain} is unverified. Delivery halted.`,
      };
    }
    return this.emailConnector.submit(payload);
  }

  async checkStatus(payload: EnforcementCasePayload, currentStatus: string): Promise<ConnectorStatusResult> {
    return this.emailConnector.checkStatus(payload, currentStatus);
  }

  async retry(payload: EnforcementCasePayload, attempt: number): Promise<ConnectorSubmissionResult> {
    return this.submit(payload);
  }
}

// Register connectors
connectorRegistry.register(new EmailEnforcementConnector());
connectorRegistry.register(new YouTubeConnector());
connectorRegistry.register(new GoogleSearchConnector());
connectorRegistry.register(new WebsiteCopyrightConnector());
connectorRegistry.register(new HostAbuseConnector());
