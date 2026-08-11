/**
 * Eterna Security Architecture — Platform-Wide Error Sanitization Layer
 *
 * Prevents raw third-party vendor names, API key errors, database schemas,
 * and internal stack traces from leaking to client DevTools across all modules.
 */

export type EternaClientErrorCode =
  | "DISCOVERY_UNAVAILABLE"
  | "DISCOVERY_LIMIT_REACHED"
  | "ANALYSIS_UNAVAILABLE"
  | "STORAGE_UNAVAILABLE"
  | "IDENTITY_SERVICE_UNAVAILABLE"
  | "PLATFORM_ACTION_UNAVAILABLE"
  | "AUTHORIZATION_REQUIRED"
  | "SCAN_INTERRUPTED";

export interface SanitizedErrorResponse {
  code: EternaClientErrorCode;
  message: string;
  userFacing: boolean;
}

export function sanitizeProviderError(error: unknown): SanitizedErrorResponse {
  const rawMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const rawCode = ((error as { code?: string })?.code || "").toLowerCase();

  // Server-side diagnostic log (never sent directly to normal client UI)
  console.error("[ETERNA-SERVER-SECURITY-LOG]", {
    rawCode,
    rawMessage: rawMessage.slice(0, 300),
    timestamp: new Date().toISOString(),
  });

  if (
    rawCode.includes("quota") ||
    rawMessage.includes("quotaexceeded") ||
    rawMessage.includes("dailylimitexceeded") ||
    rawMessage.includes("quota") ||
    rawMessage.includes("402")
  ) {
    return {
      code: "DISCOVERY_LIMIT_REACHED",
      message: "Discovery source temporarily unavailable",
      userFacing: true,
    };
  }

  if (
    rawCode.includes("auth") ||
    rawCode.includes("missing") ||
    rawCode.includes("enabled") ||
    rawMessage.includes("api_key") ||
    rawMessage.includes("api key") ||
    rawMessage.includes("accessnotconfigured") ||
    rawMessage.includes("firecrawl") ||
    rawMessage.includes("serpapi") ||
    rawMessage.includes("brave") ||
    rawMessage.includes("crawl4ai") ||
    rawMessage.includes("providerused")
  ) {
    return {
      code: "DISCOVERY_UNAVAILABLE",
      message: "Discovery source temporarily unavailable",
      userFacing: true,
    };
  }

  if (rawCode.includes("rate_limit") || rawMessage.includes("429")) {
    return {
      code: "DISCOVERY_LIMIT_REACHED",
      message: "Discovery rate limit reached. Please retry shortly.",
      userFacing: true,
    };
  }

  if (
    rawMessage.includes("findings upsert failed") ||
    rawMessage.includes("postgresql") ||
    rawMessage.includes("s3") ||
    rawMessage.includes("storage")
  ) {
    return {
      code: "STORAGE_UNAVAILABLE",
      message: "Unable to save data or asset.",
      userFacing: true,
    };
  }

  if (
    rawMessage.includes("analysis failed") ||
    rawMessage.includes("classifier") ||
    rawMessage.includes("gemini") ||
    rawMessage.includes("openai") ||
    rawMessage.includes("rekognition") ||
    rawMessage.includes("aws")
  ) {
    return {
      code: "ANALYSIS_UNAVAILABLE",
      message: "Evidence analysis could not be completed.",
      userFacing: true,
    };
  }

  if (rawMessage.includes("veriff") || rawMessage.includes("sumsub") || rawMessage.includes("kyc")) {
    return {
      code: "IDENTITY_SERVICE_UNAVAILABLE",
      message: "Identity verification service is temporarily unavailable.",
      userFacing: true,
    };
  }

  if (rawMessage.includes("takedown") || rawMessage.includes("enforcement") || rawMessage.includes("submission")) {
    return {
      code: "PLATFORM_ACTION_UNAVAILABLE",
      message: "Platform action could not be processed.",
      userFacing: true,
    };
  }

  return {
    code: "SCAN_INTERRUPTED",
    message: "Operation interrupted. Please try again.",
    userFacing: true,
  };
}
