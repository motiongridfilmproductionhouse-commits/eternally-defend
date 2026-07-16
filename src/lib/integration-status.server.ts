import { env } from "./env.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IntegrationStatus = "configured" | "partially configured" | "not configured";

export interface IntegrationDiagnostics {
  supabase: IntegrationStatus;
  firecrawl: IntegrationStatus;
  youtube: IntegrationStatus;
  aws: IntegrationStatus;
  veriff: IntegrationStatus;
  googleCloud: IntegrationStatus;
  ai: IntegrationStatus;
  factChecking: IntegrationStatus;
}

export function getIntegrationDiagnostics(): IntegrationDiagnostics {
  // Supabase
  const hasSupabaseUrl = !!env.SUPABASE_URL;
  const hasSupabaseService = !!env.SUPABASE_SERVICE_ROLE_KEY;
  // Technically VITE_ variables are checked on client, but we can assume they exist if URL exists.
  const supabase = hasSupabaseUrl && hasSupabaseService ? "configured" : hasSupabaseUrl || hasSupabaseService ? "partially configured" : "not configured";

  // Firecrawl
  const firecrawl = env.FIRECRAWL_API_KEY ? "configured" : "not configured";

  // YouTube
  const youtube = env.YOUTUBE_API_KEY ? "configured" : "not configured";

  // AWS
  const hasAwsRegion = !!env.AWS_REGION;
  const hasAwsAccessKey = !!env.AWS_ACCESS_KEY_ID;
  const hasAwsSecretKey = !!env.AWS_SECRET_ACCESS_KEY;
  const hasAwsBucket = !!env.AWS_REKOGNITION_BUCKET;
  const awsCount = [hasAwsRegion, hasAwsAccessKey, hasAwsSecretKey, hasAwsBucket].filter(Boolean).length;
  const aws = awsCount === 4 ? "configured" : awsCount > 0 ? "partially configured" : "not configured";

  // Veriff
  const hasVeriffKey = !!env.VERIFF_API_KEY;
  const hasVeriffSecret = !!env.VERIFF_SHARED_SECRET;
  const veriffCount = [hasVeriffKey, hasVeriffSecret].filter(Boolean).length;
  const veriff = veriffCount === 2 ? "configured" : veriffCount > 0 ? "partially configured" : "not configured";

  // Google Cloud
  const hasGcpProjectId = !!env.GOOGLE_CLOUD_PROJECT_ID;
  const hasGcpBucket = !!env.GOOGLE_CLOUD_STORAGE_BUCKET;
  const hasGcpCreds = !!env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const hasGoogleApiKey = !!env.GOOGLE_API_KEY;
  // We can consider GCP configured if we have creds/project ID or API Key
  const gcpCount = [hasGcpProjectId, hasGcpBucket, hasGcpCreds, hasGoogleApiKey].filter(Boolean).length;
  const googleCloud = gcpCount >= 2 ? "configured" : gcpCount > 0 ? "partially configured" : "not configured";

  // AI (Lovable / Gemini)
  const ai = env.LOVABLE_API_KEY ? "configured" : "not configured";

  // Fact Checking
  const factChecking = env.FACT_CHECK_API_KEY ? "configured" : "not configured";

  return {
    supabase,
    firecrawl,
    youtube,
    aws,
    veriff,
    googleCloud,
    ai,
    factChecking
  };
}

export const getIntegrationStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Basic admin check
    const { data: myRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = ((myRoles ?? []) as Array<{ role: string }>).some(
      (r) => r.role === "admin" || r.role === "super_admin",
    );
    if (!isAdmin) {
      throw new Error("Forbidden: admin or super_admin role required");
    }
    return getIntegrationDiagnostics();
  });
