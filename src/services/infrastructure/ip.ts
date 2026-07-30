import { IpResult } from "./types";

const TOKEN = process.env.IPINFO_TOKEN;

export async function lookupIP(ip: string): Promise<IpResult> {
  if (!TOKEN) {
    throw new Error("Missing IPINFO_TOKEN environment variable");
  }

  const response = await fetch(
    `https://ipinfo.io/${ip}?token=${TOKEN}`
  );

  if (!response.ok) {
    throw new Error(`IPInfo request failed (${response.status})`);
  }

  const data = await response.json();

  return {
    ip,
    country: data.country,
    region: data.region,
    city: data.city,
    org: data.org,
    hostname: data.hostname,
    asn: data.org,
  };
}
