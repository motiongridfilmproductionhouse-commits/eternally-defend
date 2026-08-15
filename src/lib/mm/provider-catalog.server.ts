/**
 * Server-side provider activation catalog.
 *
 * The catalog (feature-flag names, required credential variable names and
 * activation instructions) used to live in the admin route component, which
 * shipped those internal environment-variable names inside a publicly
 * downloadable client chunk. It is now resolved server-side and returned only
 * to authenticated admins. No credential VALUES are ever returned — only
 * boolean presence.
 */
import { getProviderConfig } from "./providers.server";

export type CredentialKind = "api_key" | "service_account" | "bucket";

export interface ProviderCatalogCredential {
  name: string;
  kind: CredentialKind;
  present: boolean;
}

export interface ProviderCatalogEntry {
  key: string;
  label: string;
  flag: string;
  mode: string;
  live: boolean;
  activateBy: string;
  requiredCredentials: ProviderCatalogCredential[];
}

export function buildProviderCatalog(): ProviderCatalogEntry[] {
  const cfg = getProviderConfig();
  const hasServiceAccount = Boolean(cfg.hasServiceAccount);
  const hasFactCheckKey = Boolean(cfg.factCheckApiKey);
  const hasGoogleApiKey = Boolean(cfg.googleApiKey);
  const hasProjectId = Boolean(cfg.projectId);
  const hasBucket = Boolean(cfg.bucket);

  return [
    {
      key: "fact_check",
      label: "Fact Check Tools",
      flag: "MM_PROVIDER_FACT_CHECK",
      mode: String(cfg.factCheck),
      live: hasFactCheckKey && cfg.factCheck !== "stub",
      activateBy: "Set MM_PROVIDER_FACT_CHECK=google_api_key",
      requiredCredentials: [
        { name: "FACT_CHECK_API_KEY", kind: "api_key", present: hasFactCheckKey },
      ],
    },
    {
      key: "translation",
      label: "Google Translation",
      flag: "MM_PROVIDER_TRANSLATION",
      mode: String(cfg.translation),
      live: hasGoogleApiKey && cfg.translation !== "stub",
      activateBy: "Set MM_PROVIDER_TRANSLATION=google_api_key",
      requiredCredentials: [{ name: "GOOGLE_API_KEY", kind: "api_key", present: hasGoogleApiKey }],
    },
    {
      key: "video_intelligence",
      label: "Video Intelligence",
      flag: "MM_PROVIDER_VIDEO_INTELLIGENCE",
      mode: String(cfg.videoIntelligence),
      live: hasServiceAccount && cfg.videoIntelligence === "google_service_account",
      activateBy: "Set MM_PROVIDER_VIDEO_INTELLIGENCE=google_service_account",
      requiredCredentials: [
        {
          name: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          kind: "service_account",
          present: hasServiceAccount,
        },
        { name: "GOOGLE_CLOUD_PROJECT_ID", kind: "api_key", present: hasProjectId },
        { name: "GOOGLE_CLOUD_STORAGE_BUCKET", kind: "bucket", present: hasBucket },
      ],
    },
    {
      key: "speech_to_text",
      label: "Speech-to-Text",
      flag: "MM_PROVIDER_SPEECH_TO_TEXT",
      mode: String(cfg.speechToText),
      live: hasServiceAccount && cfg.speechToText === "google_service_account",
      activateBy: "Set MM_PROVIDER_SPEECH_TO_TEXT=google_service_account",
      requiredCredentials: [
        {
          name: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          kind: "service_account",
          present: hasServiceAccount,
        },
      ],
    },
    {
      key: "vision",
      label: "Cloud Vision",
      flag: "MM_PROVIDER_VISION",
      mode: String(cfg.vision),
      live: hasServiceAccount && cfg.vision === "google_service_account",
      activateBy: "Set MM_PROVIDER_VISION=google_service_account",
      requiredCredentials: [
        {
          name: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          kind: "service_account",
          present: hasServiceAccount,
        },
      ],
    },
  ];
}

export async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data: myRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = ((myRoles ?? []) as Array<{ role: string }>).some(
    (r) => r.role === "admin" || r.role === "super_admin",
  );
  if (isAdmin) return;
  // Bootstrap parity with health.functions: allow when no admin exists yet.
  const { data: anyAdmin } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role", ["admin", "super_admin"])
    .limit(1);
  if (!anyAdmin || anyAdmin.length === 0) return;
  throw new Error("Forbidden");
}
