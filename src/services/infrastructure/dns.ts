import dns from "node:dns/promises";
import { DnsResult } from "./types";

export async function lookupDNS(hostname: string): Promise<DnsResult> {
  const result: DnsResult = {
    hostname,
  };

  try {
    const ipv4 = await dns.resolve4(hostname);
    result.ipv4 = ipv4[0];
  } catch {}

  try {
    const ipv6 = await dns.resolve6(hostname);
    result.ipv6 = ipv6[0];
  } catch {}

  try {
    result.ns = await dns.resolveNs(hostname);
  } catch {}

  try {
    const mx = await dns.resolveMx(hostname);
    result.mx = mx.map((m) => m.exchange);
  } catch {}

  try {
    result.cname = await dns.resolveCname(hostname);
  } catch {}

  return result;
}
