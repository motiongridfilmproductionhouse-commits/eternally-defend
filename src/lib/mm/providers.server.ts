/**
 * Provider registry + feature flags for Multimedia Intelligence.
 * Values come from MM_PROVIDER_* env vars. When a provider is "stub",
 * calls return a stage_status of "unavailable" with a clear reason so the
 * orchestrator can continue with the remaining providers.
 */

export type ProviderMode = "google_service_account" | "google_api_key" | "google" | "stub";

export interface ProviderConfig {
  videoIntelligence: ProviderMode;
  speechToText: ProviderMode;
  vision: ProviderMode;
  translation: ProviderMode;
  factCheck: ProviderMode;
  projectId: string | null;
  bucket: string | null;
  googleApiKey: string | null;
  factCheckApiKey: string | null;
  hasServiceAccount: boolean;
}

export function getProviderConfig(): ProviderConfig {
  return {
    videoIntelligence: (process.env.MM_PROVIDER_VIDEO_INTELLIGENCE as ProviderMode) ?? "stub",
    speechToText: (process.env.MM_PROVIDER_SPEECH_TO_TEXT as ProviderMode) ?? "stub",
    vision: (process.env.MM_PROVIDER_VISION as ProviderMode) ?? "stub",
    translation: (process.env.MM_PROVIDER_TRANSLATION as ProviderMode) ?? "stub",
    factCheck: (process.env.MM_PROVIDER_FACT_CHECK as ProviderMode) ?? "stub",
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID ?? null,
    bucket: process.env.GOOGLE_CLOUD_STORAGE_BUCKET ?? null,
    googleApiKey: process.env.GOOGLE_API_KEY ?? null,
    factCheckApiKey: process.env.FACT_CHECK_API_KEY ?? null,
    hasServiceAccount: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
  };
}

export interface ProviderResult<T> {
  status: "ok" | "unavailable" | "failed";
  reason?: string;
  data?: T;
}

export function unavailable<T>(reason: string): ProviderResult<T> {
  return { status: "unavailable", reason };
}

export function ok<T>(data: T): ProviderResult<T> {
  return { status: "ok", data };
}

export function failed<T>(reason: string): ProviderResult<T> {
  return { status: "failed", reason };
}
