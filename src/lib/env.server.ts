import { z } from "zod";

const serverEnvSchema = z.object({
  // Core startup variables (Required)
  VITE_SUPABASE_URL: z.string().url("VITE_SUPABASE_URL is required"),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1, "VITE_SUPABASE_PUBLISHABLE_KEY is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, "SUPABASE_PUBLISHABLE_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  PUBLIC_APP_URL: z.string().url("PUBLIC_APP_URL is required"),
  
  // Optional integrations
  FIRECRAWL_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REKOGNITION_BUCKET: z.string().optional(),
  
  VERIFF_API_KEY: z.string().optional(),
  VERIFF_SHARED_SECRET: z.string().optional(),
  VERIFF_BASE_URL: z.string().url("VERIFF_BASE_URL must be a valid URL").optional().default("https://stationapi.veriff.com"),
  
  LOVABLE_API_KEY: z.string().optional(),
  FACT_CHECK_API_KEY: z.string().optional(),
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  GOOGLE_CLOUD_STORAGE_BUCKET: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().optional(),
});

export function validateServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);
  
  if (!parsed.success) {
    console.error("❌ Invalid or missing server environment variables:");
    for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
      console.error(`  - ${key}: ${errors.join(", ")}`);
    }
    throw new Error("Missing required server environment variables. Please check your .env file.");
  }
  if (process.env.NODE_ENV === "production" && !parsed.data.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing required server environment variable: SUPABASE_SERVICE_ROLE_KEY is required in production.");
  }
  
  return parsed.data;
}

export const env = validateServerEnv();
