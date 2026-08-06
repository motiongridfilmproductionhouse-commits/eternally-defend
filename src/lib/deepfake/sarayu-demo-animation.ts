export type SarayuDemoStage =
  | "identity"
  | "embeddings"
  | "discovery"
  | "analysis"
  | "verification"
  | "classification"
  | "complete";

export type SarayuDemoProgress = {
  stage: SarayuDemoStage;
  progress: number;
  queries: number;
  domains: number;
  pages: number;
  faceComparisons: number;
  verifiedPages: number;
  highRiskFindings: number;
};

export const SARAYU_DEMO_DURATION_MS = 15_000;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const interpolate = (elapsedMs: number, start: number, end: number, maximum: number) =>
  Math.round(clamp((elapsedMs - start) / (end - start), 0, 1) * maximum);

export function sarayuDemoProgressAt(elapsedMs: number): SarayuDemoProgress {
  const elapsed = clamp(elapsedMs, 0, SARAYU_DEMO_DURATION_MS);
  let stage: SarayuDemoStage = "identity";
  if (elapsed >= 15_000) stage = "complete";
  else if (elapsed >= 13_000) stage = "classification";
  else if (elapsed >= 11_000) stage = "verification";
  else if (elapsed >= 8_000) stage = "analysis";
  else if (elapsed >= 5_000) stage = "discovery";
  else if (elapsed >= 2_000) stage = "embeddings";

  return {
    stage,
    progress: elapsed / SARAYU_DEMO_DURATION_MS,
    queries: interpolate(elapsed, 2_000, 8_000, 39),
    domains: interpolate(elapsed, 5_000, 11_000, 3),
    pages: interpolate(elapsed, 8_000, 11_000, 7),
    faceComparisons: interpolate(elapsed, 8_000, 11_000, 7),
    verifiedPages: interpolate(elapsed, 11_000, 13_000, 7),
    highRiskFindings: interpolate(elapsed, 13_000, 15_000, 7),
  };
}

export function sarayuDemoSessionKey(
  scanId: string | null,
  profileId: string | null,
): string | null {
  if (scanId) return `sarayu-demo-animation:${scanId}`;
  if (profileId) return `sarayu-demo-animation:profile:${profileId}`;
  return null;
}
