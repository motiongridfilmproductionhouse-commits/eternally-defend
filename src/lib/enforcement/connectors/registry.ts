/**
 * Centralized Enforcement Connector Registry.
 * Defines connector contracts, submission methods, and rate limiting validation.
 */

export type SubmissionMethod =
  | "OFFICIAL_API"
  | "APPROVED_INTEGRATION"
  | "EMAIL"
  | "SUPPORTED_REPORTING_WORKFLOW"
  | "HUMAN_REQUIRED";

export type EnforcementBasis =
  | "COPYRIGHT"
  | "SEARCH_ENGINE_COPYRIGHT"
  | "IMPERSONATION"
  | "DEEPFAKE"
  | "PRIVACY"
  | "NCII"
  | "PLATFORM_POLICY"
  | "WEBSITE_COPYRIGHT"
  | "HOST_ESCALATION"
  | "UNKNOWN";

export interface EnforcementCasePayload {
  caseId: string;
  userId: string;
  targetUrl: string;
  domain: string;
  platform: string;
  enforcementBasis: EnforcementBasis;
  protectedAssetId?: string | null;
  complainantName: string;
  complainantEmail: string;
  authorizationLevel: string;
  signedAt?: string | null;
  destinationEmail?: string | null;
  destinationRouteStatus?: string;
  evidencePdfPath?: string | null;
  authorizationPdfPath?: string | null;
  complaintPdfPath?: string | null;
  demoMode?: boolean;
  /**
   * Pre-rendered notice (subject/body) produced before the pre-send snapshot.
   * When present the connector MUST send exactly this content so the persisted
   * notice hash matches what the provider received.
   */
  preparedNotice?: { subject: string; textBody: string } | null;
}

export interface ConnectorValidationResult {
  ok: boolean;
  issues: string[];
}

export interface ConnectorSubmissionResult {
  success: boolean;
  status:
    | "PREPARED"
    | "QUEUED"
    | "SENDING"
    | "PROVIDER_ACCEPTED"
    | "DELIVERED"
    | "SUBMITTED"
    | "HUMAN_ACTION_REQUIRED"
    | "FAILED"
    | "FAILED_RETRYABLE"
    | "BOUNCED"
    | "CONFIGURATION_ERROR"
    | "ROUTE_DISCOVERY_REQUIRED"
    | "DEMO_MODE_BLOCKED"
    | "KILL_SWITCH_ACTIVE"
    | "NOTICE_INCOMPLETE"
    | "EMERGENCY_PAUSED"
    | "PRODUCTION_APPROVAL_REQUIRED"
    | "QUEUED_FOR_CONTROLLED_RELEASE";
  provider?: "POSTMARK" | "RESEND" | string;
  providerMessageId?: string | null;
  trackingRef?: string | null;
  notes?: string | null;
  error?: string | null;
  /** Recipient the notice was addressed to by routing. */
  intendedRecipient?: string | null;
  /** Recipient the provider actually accepted (test mode redirects this). */
  actualRecipient?: string | null;
}

export interface ConnectorStatusResult {
  status:
    | "SUBMITTED"
    | "ACKNOWLEDGED"
    | "UNDER_REVIEW"
    | "STILL_LIVE"
    | "SEARCH_DELISTED"
    | "CONTENT_REMOVED"
    | "SOURCE_REMOVED"
    | "REJECTED"
    | "FAILED"
    | "ESCALATION_REQUIRED";
  httpStatusCode?: number | null;
  isSourceUnavailable?: boolean;
  isSearchDelisted?: boolean;
  evidenceSnapshot?: Record<string, unknown>;
  verifiedAt: string;
}

export interface EnforcementConnector {
  id: string;
  name: string;
  platform: string;
  submissionMethod: SubmissionMethod;
  supportedBasis: EnforcementBasis[];
  requiresHuman?: boolean;

  validate(payload: EnforcementCasePayload): Promise<ConnectorValidationResult>;
  prepare(payload: EnforcementCasePayload): Promise<Record<string, unknown>>;
  submit(payload: EnforcementCasePayload): Promise<ConnectorSubmissionResult>;
  checkStatus(
    payload: EnforcementCasePayload,
    currentStatus: string,
  ): Promise<ConnectorStatusResult>;
  retry(payload: EnforcementCasePayload, attempt: number): Promise<ConnectorSubmissionResult>;
}

class ConnectorRegistry {
  private connectors = new Map<string, EnforcementConnector>();

  register(connector: EnforcementConnector): void {
    this.connectors.set(connector.id, connector);
  }

  get(id: string): EnforcementConnector | undefined {
    return this.connectors.get(id);
  }

  getByPlatformAndBasis(platform: string, basis: EnforcementBasis): EnforcementConnector | undefined {
    for (const connector of this.connectors.values()) {
      if (
        (connector.platform.toLowerCase() === platform.toLowerCase() || connector.platform === "Email" || connector.platform === "GenericPlatform") &&
        connector.supportedBasis.includes(basis)
      ) {
        return connector;
      }
    }
    return undefined;
  }

  listAll(): EnforcementConnector[] {
    return Array.from(this.connectors.values());
  }
}

export const connectorRegistry = new ConnectorRegistry();
