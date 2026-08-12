import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const CAMPAIGN_TYPES = [
  "film",
  "music",
  "advertisement",
  "brand_partnership",
  "photoshoot",
  "social_campaign",
  "other",
] as const;

export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  film: "Film",
  music: "Music",
  advertisement: "Advertisement",
  brand_partnership: "Brand Partnership",
  photoshoot: "Photoshoot",
  social_campaign: "Social Campaign",
  other: "Other",
};

export const ASSET_KINDS = ["poster", "trailer", "photo", "video", "link"] as const;
export type CampaignAssetKind = (typeof ASSET_KINDS)[number];

const AssetSchema = z.object({
  asset_kind: z.enum(ASSET_KINDS),
  title: z.string().trim().max(160).optional(),
  source_url: z.string().trim().url().max(1000).optional(),
  storage_path: z.string().trim().max(500).optional(),
});

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  campaign_type: z.enum(CAMPAIGN_TYPES),
  notes: z.string().trim().max(2000).optional(),
  hashtags: z.array(z.string().trim().max(80)).max(30).default([]),
  official_urls: z.array(z.string().trim().url().max(1000)).max(30).default([]),
  approved_accounts: z.array(z.string().trim().max(200)).max(50).default([]),
  approved_media_urls: z.array(z.string().trim().url().max(1000)).max(50).default([]),
  starts_at: z.string().trim().min(4).max(40).optional(),
  ends_at: z.string().trim().min(4).max(40).optional(),
  assets: z.array(AssetSchema).max(50).default([]),
  start_monitoring: z.boolean().default(true),
});

export type CampaignAssetRow = {
  id: string;
  asset_kind: string;
  title: string | null;
  source_url: string | null;
  storage_path: string | null;
};

export type CampaignRow = {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  notes: string | null;
  hashtags: string[];
  official_urls: string[];
  approved_accounts: string[];
  approved_media_urls: string[];
  starts_at: string | null;
  ends_at: string | null;
  monitoring_started_at: string | null;
  archived_at: string | null;
  created_at: string;
  assets: CampaignAssetRow[];
};

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: campaigns, error } = await supabase
      .from("celebrity_campaigns")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (campaigns ?? []).map((c) => c.id);
    let assets: Record<string, CampaignAssetRow[]> = {};
    if (ids.length) {
      const { data: assetRows } = await supabase
        .from("celebrity_campaign_assets")
        .select("id, campaign_id, asset_kind, title, source_url, storage_path")
        .in("campaign_id", ids);
      assets = (assetRows ?? []).reduce<Record<string, CampaignAssetRow[]>>((acc, row) => {
        const list = acc[row.campaign_id] ?? [];
        list.push({
          id: row.id,
          asset_kind: row.asset_kind,
          title: row.title,
          source_url: row.source_url,
          storage_path: row.storage_path,
        });
        acc[row.campaign_id] = list;
        return acc;
      }, {});
    }

    return {
      campaigns: (campaigns ?? []).map((c) => ({
        ...c,
        hashtags: c.hashtags ?? [],
        official_urls: c.official_urls ?? [],
        approved_accounts: c.approved_accounts ?? [],
        approved_media_urls: c.approved_media_urls ?? [],
        assets: assets[c.id] ?? [],
      })) as CampaignRow[],
    };
  });

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof CreateSchema>) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: campaign, error } = await supabase
      .from("celebrity_campaigns")
      .insert({
        user_id: userId,
        name: data.name,
        campaign_type: data.campaign_type,
        notes: data.notes ?? null,
        hashtags: data.hashtags,
        official_urls: data.official_urls,
        status: "ACTIVE",
        monitoring_started_at: data.start_monitoring ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error || !campaign) throw new Error(error?.message ?? "Could not create campaign");

    if (data.assets.length) {
      const { error: assetError } = await supabase.from("celebrity_campaign_assets").insert(
        data.assets.map((a) => ({
          campaign_id: campaign.id,
          user_id: userId,
          asset_kind: a.asset_kind,
          title: a.title ?? null,
          source_url: a.source_url ?? null,
          storage_path: a.storage_path ?? null,
        })),
      );
      if (assetError) throw new Error(assetError.message);
    }

    return { id: campaign.id };
  });

const StatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
});

export const setCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof StatusSchema>) => StatusSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const archiving = data.status === "ARCHIVED";
    const { error } = await supabase
      .from("celebrity_campaigns")
      .update({
        status: data.status,
        archived_at: archiving ? new Date().toISOString() : null,
        monitoring_started_at: archiving ? null : new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
