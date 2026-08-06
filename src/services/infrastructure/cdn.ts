export function detectCDN(headers: Headers, nameservers: string[]) {
  const server = headers.get("server")?.toLowerCase() ?? "";

  if (server.includes("cloudflare") || nameservers.some((ns) => ns.includes("cloudflare"))) {
    return "Cloudflare";
  }

  if (server.includes("akamai")) return "Akamai";
  if (server.includes("fastly")) return "Fastly";
  if (server.includes("cloudfront")) return "CloudFront";

  return "Unknown";
}
