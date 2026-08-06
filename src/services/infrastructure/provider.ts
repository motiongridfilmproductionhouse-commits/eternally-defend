export interface ProviderResult {
  organization: string;
  hosting: string;
  asn?: string;
  country?: string;
}

export function detectProvider(
  ip?: string,
  cdn?: string,
  headers: Record<string, string> = {},
): ProviderResult {
  const server = headers["server"]?.toLowerCase() ?? "";

  if (cdn === "Cloudflare" || server.includes("cloudflare")) {
    return {
      organization: "Cloudflare Inc.",
      hosting: "Cloudflare",
      asn: "AS13335",
    };
  }

  if (server.includes("cloudfront")) {
    return {
      organization: "Amazon Web Services",
      hosting: "CloudFront",
    };
  }

  if (server.includes("fastly")) {
    return {
      organization: "Fastly",
      hosting: "Fastly",
    };
  }

  if (server.includes("akamai")) {
    return {
      organization: "Akamai",
      hosting: "Akamai",
    };
  }

  return {
    organization: "Unknown",
    hosting: "Unknown",
  };
}
