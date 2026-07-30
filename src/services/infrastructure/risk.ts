export interface RiskResult {
  score: number;
  severity: "Low" | "Medium" | "High";
  reasons: string[];
}

export function calculateRisk(data: {
  cdn?: string;
  provider?: {
    organization?: string;
    hosting?: string;
  };
  http?: {
    status?: number;
    headers?: Record<string, string>;
  };
}): RiskResult {
  let score = 0;
  const reasons: string[] = [];

  if (data.http?.status === 200) {
    score += 20;
    reasons.push("Website is publicly accessible");
  }

  if (data.cdn === "Cloudflare") {
    score += 20;
    reasons.push("Cloudflare CDN detected");
  }

  const headers = data.http?.headers ?? {};

  if (headers["cf-edge-cache"]) {
    score += 10;
    reasons.push("Dynamic Cloudflare cache enabled");
  }

  if (headers["link"]?.includes("/wp-json")) {
    score += 20;
    reasons.push("WordPress REST API detected");
  }

  if (headers["server"]?.toLowerCase().includes("cloudflare")) {
    score += 10;
    reasons.push("Server protected by Cloudflare");
  }

  if (data.provider?.organization) {
    score += 10;
    reasons.push(`Hosting via ${data.provider.organization}`);
  }

  let severity: "Low" | "Medium" | "High" = "Low";

  if (score >= 70) severity = "High";
  else if (score >= 40) severity = "Medium";

  return {
    score,
    severity,
    reasons,
  };
}
