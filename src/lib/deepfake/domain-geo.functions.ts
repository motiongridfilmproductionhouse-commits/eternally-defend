import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  domains: z.array(z.string().min(3).max(255)).max(40),
});

export interface ResolvedHostGeo {
  domain: string;
  ip: string | null;
  country: string | null;
  countryName: string | null;
  organization: string | null;
}

const cache = new Map<string, { value: ResolvedHostGeo; expires: number }>();
const TTL_MS = 6 * 60 * 60 * 1000;

async function resolveIp(domain: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`,
      { headers: { accept: "application/dns-json" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
    const a = (json.Answer ?? []).find((r) => r.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(r.data));
    return a?.data ?? null;
  } catch {
    return null;
  }
}

async function lookupIpGeo(ip: string): Promise<{ country: string | null; countryName: string | null; organization: string | null }> {
  try {
    const res = await fetch(`https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`);
    if (!res.ok) return { country: null, countryName: null, organization: null };
    const json = (await res.json()) as {
      country_code?: string;
      country?: string;
      organization_name?: string;
      organization?: string;
    };
    const code = (json.country_code ?? "").toUpperCase();
    return {
      country: /^[A-Z]{2}$/.test(code) ? code : null,
      countryName: json.country ?? null,
      organization: json.organization_name ?? json.organization ?? null,
    };
  } catch {
    return { country: null, countryName: null, organization: null };
  }
}

/**
 * Resolve the real hosting country of one or more domains using public DNS +
 * IP geolocation. Read-only, cached in-process, never fabricates a location.
 */
export const resolveHostGeoBatch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const unique = Array.from(
      new Set(
        data.domains
          .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
          .filter(Boolean),
      ),
    );

    const now = Date.now();
    const out: ResolvedHostGeo[] = [];
    const pending: string[] = [];

    for (const domain of unique) {
      const hit = cache.get(domain);
      if (hit && hit.expires > now) out.push(hit.value);
      else pending.push(domain);
    }

    const resolved = await Promise.all(
      pending.map(async (domain): Promise<ResolvedHostGeo> => {
        const ip = await resolveIp(domain);
        if (!ip) return { domain, ip: null, country: null, countryName: null, organization: null };
        const geo = await lookupIpGeo(ip);
        return { domain, ip, ...geo };
      }),
    );

    for (const value of resolved) {
      cache.set(value.domain, { value, expires: now + TTL_MS });
      out.push(value);
    }

    return { hosts: out };
  });
