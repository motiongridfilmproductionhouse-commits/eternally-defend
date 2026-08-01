/**
 * Shared public-URL safety checks for discovery/verification network I/O.
 * Rejects non-http(s), localhost, private/reserved IPs (incl. IPv4-mapped IPv6),
 * and supports DNS resolution + pinned undici fetch where available.
 */

import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

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

/** Strip IPv6 URL brackets: `[::1]` → `::1`. */
export function stripIpBrackets(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

export function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return true;
  const [a, b] = parts;
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export function isPrivateOrReservedIpv6(address: string): boolean {
  const addr = stripIpBrackets(address).toLowerCase();
  if (!addr) return true;

  // IPv4-mapped IPv6: :ffff:127.0.0.1 or ::ffff:7f00:1
  const dotted = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted?.[1]) return isPrivateOrReservedIpv4(dotted[1]);

  const hexMapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMapped) {
    const hi = Number.parseInt(hexMapped[1]!, 16);
    const lo = Number.parseInt(hexMapped[2]!, 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateOrReservedIpv4(v4);
    }
  }

  if (addr === "::" || addr === "::1") return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA
  if (addr.startsWith("fe80:")) return true; // link-local
  if (addr.startsWith("ff")) return true; // multicast
  return false;
}

export function isPrivateOrReservedIpAddress(address: string): boolean {
  const addr = stripIpBrackets(address);
  if (net.isIP(addr) === 4) return isPrivateOrReservedIpv4(addr);
  if (net.isIP(addr) === 6) return isPrivateOrReservedIpv6(addr);
  return true;
}

export function isPrivateOrReservedHostname(hostname: string): boolean {
  const host = stripIpBrackets(hostname).replace(/\.+$/, "");
  if (!host) return true;
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }

  if (net.isIP(host)) {
    return isPrivateOrReservedIpAddress(host);
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
  if (!contentType) return true;
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    base === "application/json" ||
    base === "text/json" ||
    base.endsWith("+json")
  );
}

export type DnsLookupAll = (
  hostname: string,
  options: dns.LookupAllOptions,
) => Promise<dns.LookupAddress[]>;

let testDnsLookupAll: DnsLookupAll | null = null;

/** Test-only DNS stub so unit tests can use reserved .example hosts safely. */
export function setTestDnsLookupAll(lookupAll: DnsLookupAll | null): void {
  testDnsLookupAll = lookupAll;
}

function defaultDnsLookupAll(
  hostname: string,
  options: dns.LookupAllOptions,
): Promise<dns.LookupAddress[]> {
  if (testDnsLookupAll) {
    return testDnsLookupAll(hostname, options);
  }
  return dnsPromises.lookup(hostname, options);
}

export async function resolvePublicAddresses(
  hostname: string,
  lookupAll: DnsLookupAll = defaultDnsLookupAll,
): Promise<string[]> {
  const host = stripIpBrackets(hostname);
  if (!host) throw new Error("Empty hostname");
  if (isPrivateOrReservedHostname(host)) {
    throw new Error(`Blocked private/reserved host: ${host}`);
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIpAddress(host)) {
      throw new Error(`Blocked private/reserved IP: ${host}`);
    }
    return [host];
  }

  const records = await lookupAll(host, { all: true, verbatim: true });
  const publicAddresses = records
    .map((record) => record.address)
    .filter((address) => !isPrivateOrReservedIpAddress(address));

  if (!publicAddresses.length) {
    throw new Error(`DNS for ${host} resolved only to private/reserved addresses`);
  }
  return publicAddresses;
}

export async function assertSafePublicUrlForFetch(
  url: string,
  lookupAll?: DnsLookupAll,
): Promise<{
  parsed: URL;
  addresses: string[];
}> {
  if (!isSafePublicHttpUrl(url)) {
    throw new Error("URL failed public http(s) safety checks");
  }
  const parsed = new URL(url);
  const addresses = await resolvePublicAddresses(parsed.hostname, lookupAll);
  return { parsed, addresses };
}

/**
 * Fetch a public URL after DNS validation. Pins the TCP connect to a validated
 * public address via undici (DNS-rebinding protection) and never auto-follows
 * redirects — callers must validate each Location hop.
 *
 * Uses globalThis.fetch when available so unit tests can stub network I/O
 * after the safety checks run; undici is the production fallback.
 */
export async function fetchPublicHttpUrl(
  url: string,
  init?: RequestInit & {
    signal?: AbortSignal;
    lookupAll?: DnsLookupAll;
  },
): Promise<Response> {
  const { parsed, addresses } = await assertSafePublicUrlForFetch(
    url,
    init?.lookupAll,
  );
  const pinned = addresses[0]!;
  const family = net.isIP(pinned) === 6 ? 6 : 4;

  const agent = new Agent({
    connect: {
      lookup(_hostname, _options, callback) {
        callback(null, pinned, family);
      },
    },
  });

  const requestInit = {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal,
    redirect: "manual" as const,
    // undici-specific: pin connect to the pre-validated public address
    dispatcher: agent,
  };

  try {
    if (typeof globalThis.fetch === "function") {
      try {
        return await globalThis.fetch(
          parsed.toString(),
          requestInit as RequestInit,
        );
      } catch (error) {
        // Stubbed fetch implementations may reject unknown options — retry plain.
        if (
          error instanceof TypeError ||
          (error instanceof Error && /dispatcher|unexpected/i.test(error.message))
        ) {
          return await globalThis.fetch(parsed.toString(), {
            method: requestInit.method,
            headers: requestInit.headers,
            body: requestInit.body as BodyInit | null | undefined,
            signal: requestInit.signal,
            redirect: "manual",
          });
        }
        throw error;
      }
    }

    return (await undiciFetch(parsed.toString(), {
      method: requestInit.method,
      headers: requestInit.headers as any,
      body: requestInit.body as any,
      signal: requestInit.signal as any,
      redirect: "manual",
      dispatcher: agent,
    })) as unknown as Response;
  } finally {
    // Close after the current turn so header-only callers can finish first.
    queueMicrotask(() => {
      void agent.close();
    });
  }
}
