/**
 * Shared public-URL safety checks for discovery/verification network I/O.
 * Rejects non-http(s), localhost, private/reserved IPs (incl. IPv4-mapped IPv6).
 *
 * Direct URL verification uses DNS-rebinding-safe undici IP pinning:
 * connect only to a validated public address while preserving TLS SNI via
 * the original hostname. Node 22 autoSelectFamily lookup shapes are supported.
 *
 * Custom dispatchers must never be attached to Firecrawl SDK/API calls.
 */

import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export const MAX_SAFE_RESPONSE_BYTES = 1_500_000;
export const MAX_SAFE_TEXT_LEN = 500;
/** Bound for fallback drain when body.cancel() is unavailable. */
const MAX_PROBE_DRAIN_BYTES = 64_000;

export type SafeFetchFailureCategory =
  | "dns_resolution_failed"
  | "private_address_rejected"
  | "tls_connection_failed"
  | "request_timeout"
  | "redirect_rejected"
  | "crawl_provider_failed"
  | "network_failed"
  | "url_safety_rejected";

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

export type PinnedLookupCallback = (
  hostname: string,
  options: unknown,
  callback: (
    err: Error | null,
    address?: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
) => void;

export type PinnedFetchPin = {
  address: string;
  family: 4 | 6;
  servername: string;
  lookup: PinnedLookupCallback;
};

export type TestPinnedHttpFetch = (
  url: string,
  init: {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
    signal?: AbortSignal;
    redirect: "manual";
  },
  pin: PinnedFetchPin,
) => Promise<Response>;

let testPinnedHttpFetch: TestPinnedHttpFetch | null = null;

/**
 * Test-only override for the HTTP transport after DNS pin selection.
 * The pin metadata is always computed from the validated DNS result first;
 * implementations must not perform a second unvalidated DNS lookup.
 */
export function setTestPinnedHttpFetch(fn: TestPinnedHttpFetch | null): void {
  testPinnedHttpFetch = fn;
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

async function withAbortSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Aborted");
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        signal.reason instanceof Error ? signal.reason : new Error("Aborted"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Prefer IPv4 on dual-stack hosts — more reliable on Vercel/serverless. */
export function preferIpv4Addresses(addresses: string[]): string[] {
  const v4 = addresses.filter((address) => net.isIP(address) === 4);
  const v6 = addresses.filter((address) => net.isIP(address) === 6);
  return v4.length ? [...v4, ...v6] : addresses;
}

/**
 * Node 22-compatible pinned connect.lookup:
 * - options.all=true → callback(null, [{ address, family }])
 * - otherwise → callback(null, address, family)
 * Always returns the pre-validated public address (DNS-rebinding safe).
 */
export function createPinnedLookup(
  pinned: string,
  family: 4 | 6,
): PinnedLookupCallback {
  if (isPrivateOrReservedIpAddress(pinned)) {
    throw Object.assign(
      new Error(`Refusing to pin private/reserved address: ${pinned}`),
      { failureCategory: "private_address_rejected" as const },
    );
  }

  return (_hostname, options, callback) => {
    const opts =
      typeof options === "object" && options
        ? (options as { all?: boolean })
        : {};
    if (opts.all) {
      callback(null, [{ address: pinned, family }]);
      return;
    }
    callback(null, pinned, family);
  };
}

export async function resolvePublicAddresses(
  hostname: string,
  lookupAll: DnsLookupAll = defaultDnsLookupAll,
  signal?: AbortSignal,
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

  let records: dns.LookupAddress[];
  try {
    records = await withAbortSignal(
      lookupAll(host, { all: true, verbatim: true }),
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`DNS resolution failed for ${host}: ${message}`);
    (wrapped as Error & { failureCategory?: SafeFetchFailureCategory }).failureCategory =
      "dns_resolution_failed";
    throw wrapped;
  }

  const publicAddresses = preferIpv4Addresses(
    records
      .map((record) => record.address)
      .filter((address) => !isPrivateOrReservedIpAddress(address)),
  );

  if (!publicAddresses.length) {
    const err = new Error(
      `DNS for ${host} resolved only to private/reserved addresses`,
    );
    (err as Error & { failureCategory?: SafeFetchFailureCategory }).failureCategory =
      "private_address_rejected";
    throw err;
  }
  return publicAddresses;
}

export async function assertSafePublicUrlForFetch(
  url: string,
  lookupAll?: DnsLookupAll,
  signal?: AbortSignal,
): Promise<{
  parsed: URL;
  addresses: string[];
}> {
  if (!isSafePublicHttpUrl(url)) {
    const err = new Error("URL failed public http(s) safety checks");
    (err as Error & { failureCategory?: SafeFetchFailureCategory }).failureCategory =
      "url_safety_rejected";
    throw err;
  }
  const parsed = new URL(url);
  const addresses = await resolvePublicAddresses(
    parsed.hostname,
    lookupAll,
    signal,
  );
  return { parsed, addresses };
}

/**
 * Classify network/DNS/TLS failures into safe diagnostic categories.
 * Never includes secrets, raw bodies, or provider payloads.
 */
export function classifySafeFetchFailure(
  error: unknown,
): SafeFetchFailureCategory {
  if (error && typeof error === "object") {
    const tagged = (error as { failureCategory?: SafeFetchFailureCategory })
      .failureCategory;
    if (tagged) return tagged;
  }

  const message =
    error instanceof Error
      ? `${error.name} ${error.message} ${(error as Error & { cause?: unknown }).cause ?? ""}`
      : String(error);
  const lower = message.toLowerCase();

  if (/private|reserved|blocked private/i.test(message)) {
    return "private_address_rejected";
  }
  if (/dns resolution failed|enotfound|eai_again|getaddrinfo/i.test(lower)) {
    return "dns_resolution_failed";
  }
  if (
    /cert|ssl|tls|sni|handshake|err_tls|unable to verify|altname/i.test(lower)
  ) {
    return "tls_connection_failed";
  }
  if (/timeout|timed out|etimedout|abort.*timeout/i.test(lower)) {
    return "request_timeout";
  }
  if (/redirect/i.test(lower)) {
    return "redirect_rejected";
  }
  if (/firecrawl|crawl provider|scrape/i.test(lower)) {
    return "crawl_provider_failed";
  }
  return "network_failed";
}

function tagFetchError(error: unknown): Error {
  const category = classifySafeFetchFailure(error);
  const wrapped =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Pinned fetch failed");
  (wrapped as Error & { failureCategory?: SafeFetchFailureCategory }).failureCategory =
    category;
  return wrapped;
}

function abortError(signal?: AbortSignal | null): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Aborted");
}

/** Max wait for probe-body cancel/drain so cleanup cannot stall a hop forever. */
const PROBE_BODY_CLEANUP_BUDGET_MS = 250;

/**
 * Cancel (or boundedly drain) a redirect-probe response body before retry,
 * redirect follow, or return. Keeps AbortSignal active; scan abort propagates.
 * Stalled cancel()/drain cannot hang past abort or the cleanup budget.
 */
export async function releaseProbeResponseBody(
  response: Response | null | undefined,
  signal?: AbortSignal | null,
): Promise<void> {
  if (!response?.body) {
    if (signal?.aborted) throw abortError(signal);
    return;
  }

  const body = response.body;

  if (signal?.aborted) {
    try {
      void body.cancel(signal.reason);
    } catch {
      // ignore cancel races
    }
    throw abortError(signal);
  }

  let abortReject: ((error: Error) => void) | null = null;
  const abortPromise =
    signal != null
      ? new Promise<never>((_resolve, reject) => {
          abortReject = reject;
        })
      : null;

  const onAbort = () => {
    try {
      void body.cancel(signal?.reason);
    } catch {
      // ignore
    }
    abortReject?.(abortError(signal));
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const cleanupWork = async () => {
    try {
      await body.cancel();
      return;
    } catch {
      // Fallback: bounded drain under the same abort signal.
    }

    try {
      const reader = body.getReader();
      let read = 0;
      try {
        while (read < MAX_PROBE_DRAIN_BYTES) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          read += value?.byteLength ?? 0;
        }
      } finally {
        try {
          void reader.cancel(signal?.reason);
        } catch {
          // ignore
        }
        try {
          reader.releaseLock();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore cleanup failures
    }
  };

  const budgetPromise = new Promise<void>((resolve) => {
    setTimeout(resolve, PROBE_BODY_CLEANUP_BUDGET_MS);
  });

  try {
    const racers: Array<Promise<unknown>> = [cleanupWork(), budgetPromise];
    if (abortPromise) racers.push(abortPromise);
    await Promise.race(racers);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  if (signal?.aborted) {
    throw abortError(signal);
  }
}

async function pinnedPublicHttpFetch(
  url: string,
  init?: RequestInit & {
    signal?: AbortSignal;
    lookupAll?: DnsLookupAll;
  },
): Promise<Response> {
  const { parsed, addresses } = await assertSafePublicUrlForFetch(
    url,
    init?.lookupAll,
    init?.signal,
  );
  const pinned = addresses[0]!;
  const family: 4 | 6 = net.isIP(pinned) === 6 ? 6 : 4;
  // Preserve original hostname for TLS SNI / certificate validation.
  const servername = stripIpBrackets(parsed.hostname);
  const lookup = createPinnedLookup(pinned, family);
  const requestUrl = parsed.toString();
  const requestInit = {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body ?? null,
    signal: init?.signal,
    redirect: "manual" as const,
  };
  const pin: PinnedFetchPin = {
    address: pinned,
    family,
    servername,
    lookup,
  };

  if (testPinnedHttpFetch) {
    return testPinnedHttpFetch(requestUrl, requestInit, pin);
  }

  /*
   * Unit-test adapter: when DNS is stubbed, route through globalThis.fetch
   * AFTER selecting/validating the pin and exercising the Node 22 lookup
   * shape. This never performs a second DNS lookup for connect.
   * Production never takes this branch.
   */
  if (testDnsLookupAll) {
    await new Promise<void>((resolve, reject) => {
      lookup(servername, { all: true }, (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        const addr = Array.isArray(result) ? result[0]?.address : undefined;
        if (!addr || isPrivateOrReservedIpAddress(addr)) {
          reject(
            Object.assign(
              new Error("Pinned lookup refused private/reserved address"),
              { failureCategory: "private_address_rejected" as const },
            ),
          );
          return;
        }
        if (addr !== pinned) {
          reject(new Error("Pinned lookup diverged from validated DNS result"));
          return;
        }
        resolve();
      });
    });

    return globalThis.fetch(requestUrl, {
      method: requestInit.method,
      headers: requestInit.headers,
      body: requestInit.body,
      signal: requestInit.signal,
      redirect: "manual",
    });
  }

  const agent = new Agent({
    connect: {
      servername,
      lookup(hostname, options, callback) {
        lookup(hostname, options, callback as any);
      },
    },
  });

  try {
    // Never fall back to unpinned global fetch if this throws.
    return (await undiciFetch(requestUrl, {
      method: requestInit.method,
      headers: requestInit.headers as any,
      body: requestInit.body as any,
      signal: requestInit.signal as any,
      redirect: "manual",
      dispatcher: agent,
    })) as unknown as Response;
  } catch (error) {
    throw tagFetchError(error);
  } finally {
    queueMicrotask(() => {
      void agent.close();
    });
  }
}

/**
 * DNS-rebinding-safe public HTTP(S) fetch for core URL verification.
 * Connects only to a validated public address; preserves TLS SNI hostname.
 */
export async function fetchValidatedPublicHttpUrl(
  url: string,
  init?: RequestInit & {
    signal?: AbortSignal;
    lookupAll?: DnsLookupAll;
  },
): Promise<Response> {
  return pinnedPublicHttpFetch(url, init);
}

/**
 * Same pinned transport as fetchValidatedPublicHttpUrl.
 * Reserved for optional SerpApi/media candidate fetches — never Firecrawl SDK.
 */
export async function fetchPublicHttpUrl(
  url: string,
  init?: RequestInit & {
    signal?: AbortSignal;
    lookupAll?: DnsLookupAll;
  },
): Promise<Response> {
  return pinnedPublicHttpFetch(url, init);
}
