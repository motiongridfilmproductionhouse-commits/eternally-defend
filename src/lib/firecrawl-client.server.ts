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

export interface FirecrawlEnvironmentDiagnostic {
  firecrawl_api_key_present: boolean;
  firecrawl_api_key_length: number;
  firecrawl_api_key_mode: "lovable_gateway" | "direct" | "missing";
  lovable_api_key_present: boolean;
  lovable_api_key_length: number;
  lovable_api_key_required: boolean;
  configured: boolean;
}

export function firecrawlEnvironmentDiagnostic(): FirecrawlEnvironmentDiagnostic {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY?.trim() ?? "";
  const lovableKey = process.env.LOVABLE_API_KEY?.trim() ?? "";
  const gateway = firecrawlKey.startsWith("lovc_");
  return {
    firecrawl_api_key_present: firecrawlKey.length > 0,
    firecrawl_api_key_length: firecrawlKey.length,
    firecrawl_api_key_mode: firecrawlKey.length === 0 ? "missing" : gateway ? "lovable_gateway" : "direct",
    lovable_api_key_present: lovableKey.length > 0,
    lovable_api_key_length: lovableKey.length,
    lovable_api_key_required: gateway,
    configured: firecrawlKey.length > 0 && (!gateway || lovableKey.length > 0),
  };
}

export function isFirecrawlConfigured(): boolean {
  return firecrawlEnvironmentDiagnostic().configured;
}

/** POST to a Firecrawl v2 path (e.g. "/search"). Returns the raw Response. */
export async function firecrawlFetch(
  path: string,
  body: unknown,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();

  if (!key) {
    throw new Error("FIRECRAWL_API_KEY is missing");
  }

  const gateway = key.startsWith("lovc_");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (gateway) {
    const lovableKey = process.env.LOVABLE_API_KEY?.trim();
    if (!lovableKey) {
      throw new Error("LOVABLE_API_KEY is missing for gateway Firecrawl calls");
    }
    headers.Authorization = `Bearer ${lovableKey}`;
    headers["X-Connection-Api-Key"] = key;
  } else {
    headers.Authorization = `Bearer ${key}`;
  }

  return fetch(`${gateway ? GATEWAY_BASE : DIRECT_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}
