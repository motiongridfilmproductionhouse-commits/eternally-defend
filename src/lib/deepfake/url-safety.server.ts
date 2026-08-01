/**
 * Shared public-URL safety checks for optional discovery providers.
 * Rejects non-http(s), localhost, and private/reserved hosts to reduce SSRF risk.
 */

const PRIVATE_IPV4_127 = /^127\./;
const PRIVATE_IPV4_10 = /^10\./;
const PRIVATE_IPV4_192_168 = /^192\.168\./;
const PRIVATE_IPV4_169_254 = /^169\.254\./;
const PRIVATE_IPV4_0 = /^0\./;
const PRIVATE_IPV4_100 =
  /^100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./; // 100.64.0.0/10
const PRIVATE_IPV4_172 =
  /^172\.(?:1[6-9]|2\d|3[0-1])\./; // 172.16.0.0/12
const IPV4_MULTICAST_OR_RESERVED = /^(?:22[4-9]|23\d|24\d|25[0-5])\./;

const IPV6_LOCAL = /^(?:::1|::|fc|fd|fe80:)/i;

export const MAX_SAFE_RESPONSE_BYTES = 1_500_000;
export const MAX_SAFE_TEXT_LEN = 500;

export function sanitizeProviderText(
  value: unknown,
  maxLen = MAX_SAFE_TEXT_LEN,
): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function isPrivateOrReservedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, "");
  if (!host) return true;
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }

  if (host.includes(":")) {
    return IPV6_LOCAL.test(host);
  }

  if (
    PRIVATE_IPV4_127.test(host) ||
    PRIVATE_IPV4_10.test(host) ||
    PRIVATE_IPV4_192_168.test(host) ||
    PRIVATE_IPV4_169_254.test(host) ||
    PRIVATE_IPV4_0.test(host) ||
    PRIVATE_IPV4_100.test(host) ||
    PRIVATE_IPV4_172.test(host) ||
    IPV4_MULTICAST_OR_RESERVED.test(host)
  ) {
    return true;
  }

  // Block obvious hex/decimal IP encodings of loopback.
  if (host === "2130706433" || host === "0x7f000001") return true;

  return false;
}

export function isSafePublicHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4_000) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (isPrivateOrReservedHostname(parsed.hostname)) return false;

  return true;
}

export function normalizeHostingPageUrl(value: string): string | null {
  if (!isSafePublicHttpUrl(value)) return null;
  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    // Drop common tracking params that create duplicate page identities.
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_eid)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isAllowedImageMime(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    base === "image/jpeg" ||
    base === "image/jpg" ||
    base === "image/png" ||
    base === "image/webp" ||
    base === "image/gif"
  );
}

export function isAllowedJsonMime(contentType: string | null | undefined): boolean {
  if (!contentType) return true; // SerpApi occasionally omits CT
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    base === "application/json" ||
    base === "text/json" ||
    base.endsWith("+json")
  );
}
