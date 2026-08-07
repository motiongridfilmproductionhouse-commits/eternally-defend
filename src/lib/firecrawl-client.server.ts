/**
 * Shared Firecrawl transport.
 *
 * The workspace connection can be either:
 *  - gateway-backed: FIRECRAWL_API_KEY is a Lovable connection key (lovc_...)
 *    and requests must go through the Lovable connector gateway.
 *  - direct API: FIRECRAWL_API_KEY is a real Firecrawl key (fc-...) and
 *    requests go straight to api.firecrawl.dev.
 *
 * Both modes are supported here so callers never have to care.
 */

const DIRECT_BASE = "https://api.firecrawl.dev/v2";
const GATEWAY_BASE = "https://connector-gateway.lovable.dev/firecrawl/v2";

export function isFirecrawlConfigured(): boolean {
  return firecrawlEnvironmentDiagnostic().configured;
}

export function firecrawlEnvironmentDiagnostic(): {
  firecrawl_api_key_present: boolean;
  firecrawl_api_key_length: number;
  firecrawl_api_key_mode: "direct" | "lovable_gateway" | "missing";
  lovable_api_key_required: boolean;
  lovable_api_key_present: boolean;
  lovable_api_key_length: number;
  configured: boolean;
} {
  const fcKey = process.env.FIRECRAWL_API_KEY?.trim() ?? "";
  const lovableKey = process.env.LOVABLE_API_KEY?.trim() ?? "";
  const mode = !fcKey ? "missing" : fcKey.startsWith("lovc_") ? "lovable_gateway" : "direct";
  const gatewayRequired = mode === "lovable_gateway";
  return {
    firecrawl_api_key_present: Boolean(fcKey),
    firecrawl_api_key_length: fcKey.length,
    firecrawl_api_key_mode: mode,
    lovable_api_key_required: gatewayRequired,
    lovable_api_key_present: Boolean(lovableKey),
    lovable_api_key_length: lovableKey.length,
    configured: mode === "direct" ? true : gatewayRequired ? Boolean(lovableKey) : false,
  };
}

export interface FirecrawlFetchOptions {
  signal?: AbortSignal;
  forceDirect?: boolean;
  forceGateway?: boolean;
}

/** POST to a Firecrawl v2 path (e.g. "/search"). Returns the raw Response. */
export async function firecrawlFetch(
  path: string,
  body: unknown,
  options?: FirecrawlFetchOptions,
): Promise<Response> {
  const fcKey = process.env.FIRECRAWL_API_KEY?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();

  if (!fcKey && !lovableKey) {
    throw new Error("FIRECRAWL_API_KEY is not configured");
  }

  const isGatewayKey = Boolean(fcKey?.startsWith("lovc_"));
  const useGateway =
    options?.forceGateway || (!options?.forceDirect && isGatewayKey && Boolean(lovableKey));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (useGateway) {
    if (!lovableKey) {
      throw new Error("LOVABLE_API_KEY is missing for optional gateway calls");
    }
    headers.Authorization = `Bearer ${lovableKey}`;
    if (fcKey) {
      headers["X-Connection-Api-Key"] = fcKey;
    }
  } else {
    if (!fcKey) {
      throw new Error("FIRECRAWL_API_KEY is missing for direct Firecrawl calls");
    }
    headers.Authorization = `Bearer ${fcKey}`;
  }

  const url = `${useGateway ? GATEWAY_BASE : DIRECT_BASE}${path}`;
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}
