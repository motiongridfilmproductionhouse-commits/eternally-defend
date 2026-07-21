import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { GoogleAuth } from "google-auth-library";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBucket, getS3 } from "@/lib/aws/clients.server";
import { getSignedPutUrl } from "@/lib/aws/s3.server";

const imageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export const prepareAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    fileName: z.string().min(1).max(180),
    contentType: z.enum(imageTypes),
    size: z.number().int().positive().max(10 * 1024 * 1024),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/assets/${crypto.randomUUID()}-${safeName}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 300) };
  });

type VisionPage = { url?: string; pageTitle?: string; fullMatchingImages?: Array<{ url?: string }>; partialMatchingImages?: Array<{ url?: string }> };
type VisionImage = { url?: string; score?: number };

async function webDetection(bytes: Uint8Array) {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error("Google Vision credentials are not configured.");
  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(raw); } catch { throw new Error("Google Vision credentials JSON is invalid."); }

  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
  if (!token) throw new Error("Google Vision authentication failed.");

  const response = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: Buffer.from(bytes).toString("base64") }, features: [{ type: "WEB_DETECTION", maxResults: 50 }] }] }),
  });
  const payload = await response.json() as any;
  if (!response.ok || payload?.responses?.[0]?.error) {
    throw new Error(payload?.responses?.[0]?.error?.message || payload?.error?.message || "Google Vision reverse search failed.");
  }
  const web = payload?.responses?.[0]?.webDetection ?? {};
  return {
    pages: (web.pagesWithMatchingImages ?? []).slice(0, 30).map((p: VisionPage) => ({
      url: p.url ?? "", title: p.pageTitle ?? "Matching page",
      fullMatches: p.fullMatchingImages?.length ?? 0, partialMatches: p.partialMatchingImages?.length ?? 0,
    })).filter((p: { url: string }) => p.url),
    fullMatchingImages: (web.fullMatchingImages ?? []).slice(0, 30).map((i: VisionImage) => ({ url: i.url ?? "", score: i.score ?? null })).filter((i: { url: string }) => i.url),
    partialMatchingImages: (web.partialMatchingImages ?? []).slice(0, 30).map((i: VisionImage) => ({ url: i.url ?? "", score: i.score ?? null })).filter((i: { url: string }) => i.url),
    visuallySimilarImages: (web.visuallySimilarImages ?? []).slice(0, 30).map((i: VisionImage) => ({ url: i.url ?? "", score: i.score ?? null })).filter((i: { url: string }) => i.url),
    bestGuessLabels: (web.bestGuessLabels ?? []).map((x: { label?: string }) => x.label).filter(Boolean),
  };
}

export const registerAssetAndSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    key: z.string().min(10).max(500), name: z.string().min(1).max(200),
    platform: z.string().max(100).optional(), sourceUrl: z.string().url().optional().or(z.literal("")),
    contentType: z.enum(imageTypes),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const prefix = `clients/${context.userId}/assets/`;
    if (!data.key.startsWith(prefix)) throw new Error("Invalid asset storage path.");
    const object = await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: data.key }));
    const bytes = new Uint8Array(await object.Body!.transformToByteArray());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Uploaded image is empty or too large.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reverse = await webDetection(bytes);
    const matchCount = reverse.pages.length + reverse.fullMatchingImages.length + reverse.partialMatchingImages.length;
    const { data: inserted, error } = await context.supabase.from("protected_assets").insert({
      user_id: context.userId, name: data.name.trim(), kind: "image", source_url: data.sourceUrl || null,
      storage_path: data.key, active: true,
      metadata: { platform: data.platform || null, status: "Monitoring", content_type: data.contentType, sha256, reverse_search: reverse, reverse_search_match_count: matchCount, reverse_search_at: new Date().toISOString(), reverse_search_provider: "google_vision_web_detection" },
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: inserted.id, sha256, matchCount, reverse };
  });
