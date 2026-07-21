import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBucket, getS3 } from "@/lib/aws/clients.server";
import { getSignedGetUrl, getSignedPutUrl } from "@/lib/aws/s3.server";

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

type LensMatch = {
  link?: string;
  source?: string;
  title?: string;
  thumbnail?: string;
  image?: string;
  image_url?: string;
};

async function lensSearch(imageUrl: string) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SerpApi credentials are not configured.");

  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    api_key: apiKey,
    no_cache: "true",
  });
  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json() as any;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `SerpApi reverse search failed (${response.status}).`);
  }

  const matches: LensMatch[] = [
    ...(payload.visual_matches ?? []),
    ...(payload.exact_matches ?? []),
    ...(payload.image_sources ?? []),
  ];
  const seen = new Set<string>();
  const unique = matches.filter((match) => {
    const url = match.link ?? match.image_url ?? match.image ?? "";
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0, 50);

  const pages = unique
    .filter((match) => match.link)
    .map((match) => ({
      url: match.link!,
      title: match.title ?? match.source ?? "Visual match",
      fullMatches: 0,
      partialMatches: 1,
      thumbnail: match.thumbnail ?? match.image ?? match.image_url ?? null,
      source: match.source ?? null,
    }));
  const images = unique
    .map((match) => match.image_url ?? match.image ?? match.thumbnail ?? "")
    .filter(Boolean)
    .map((url) => ({ url, score: null }));

  return {
    pages,
    fullMatchingImages: images,
    partialMatchingImages: [],
    visuallySimilarImages: images,
    bestGuessLabels: payload.knowledge_graph?.title ? [payload.knowledge_graph.title] : [],
    searchMetadata: {
      id: payload.search_metadata?.id ?? null,
      status: payload.search_metadata?.status ?? "Success",
      processedAt: new Date().toISOString(),
    },
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
    const signedImageUrl = await getSignedGetUrl(data.key, 600);
    const reverse = await lensSearch(signedImageUrl);
    const matchCount = reverse.pages.length + reverse.fullMatchingImages.length + reverse.partialMatchingImages.length;
    const { data: inserted, error } = await context.supabase.from("protected_assets").insert({
      user_id: context.userId, name: data.name.trim(), kind: "image", source_url: data.sourceUrl || null,
      storage_path: data.key, active: true,
      metadata: { platform: data.platform || null, status: "Monitoring", content_type: data.contentType, sha256, reverse_search: reverse, reverse_search_match_count: matchCount, reverse_search_at: new Date().toISOString(), reverse_search_provider: "serpapi_google_lens" },
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: inserted.id, sha256, matchCount, reverse };
  });
