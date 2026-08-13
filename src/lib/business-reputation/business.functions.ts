import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { searchBusinessListings } from "@/lib/business-reputation/places.server";
import {
  buildAliases,
  buildQueryPlan,
  type BusinessIdentityInput,
} from "@/lib/business-reputation/identity-profile";

const listingSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  formattedAddress: z.string().default(""),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  category: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  websiteDomain: z.string().nullable().optional(),
  googleMapsUrl: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  reviewCount: z.number().nullable().optional(),
  businessStatus: z.string().nullable().optional(),
  isSample: z.boolean().default(false),
  raw: z.custom<Json>(() => true).default({}),
});

/** Business listing search (Google Places when connected, sample data otherwise). */
export const searchBusinesses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ query: z.string().min(2).max(160) }).parse(raw))
  .handler(async ({ data }) => searchBusinessListings(data.query));

/** Confirms a selected business, persists its identity profile and query plan. */
export const confirmBusinessSelection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        listing: listingSchema,
        scanScope: z.enum(["branch", "brand"]).default("branch"),
        tradingName: z.string().max(200).optional(),
        parentCompany: z.string().max(200).optional(),
        previousNames: z.array(z.string().max(200)).max(20).default([]),
        abbreviations: z.array(z.string().max(60)).max(20).default([]),
        branchNames: z.array(z.string().max(200)).max(50).default([]),
        executives: z.array(z.string().max(160)).max(20).default([]),
        products: z.array(z.string().max(160)).max(30).default([]),
        industry: z.string().max(120).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const l = data.listing;

    const identity: BusinessIdentityInput = {
      officialName: l.name,
      tradingName: data.tradingName ?? null,
      parentCompany: data.parentCompany ?? null,
      previousNames: data.previousNames,
      abbreviations: data.abbreviations,
      branchNames: data.branchNames,
      executives: data.executives,
      products: data.products,
      city: l.city ?? null,
      region: l.region ?? null,
      country: l.country ?? null,
      category: l.category ?? null,
      industry: data.industry ?? null,
      websiteDomain: l.websiteDomain ?? null,
      scope: data.scanScope,
    };

    const { data: profile, error } = await supabase
      .from("business_profiles")
      .upsert(
        {
          user_id: userId,
          official_business_name: l.name,
          google_place_id: l.placeId,
          place_source: l.isSample ? "sample" : "google_places",
          place_payload: l.raw,
          website_domain: l.websiteDomain ?? null,
          website_url: l.websiteUrl ?? null,
          phone: l.phone ?? null,
          address: l.formattedAddress,
          city: l.city ?? null,
          region: l.region ?? null,
          country: l.country ?? null,
          latitude: l.latitude ?? null,
          longitude: l.longitude ?? null,
          category: l.category ?? null,
          industry: data.industry ?? null,
          google_maps_url: l.googleMapsUrl ?? null,
          rating: l.rating ?? null,
          review_count: l.reviewCount ?? null,
          business_status: l.businessStatus ?? null,
          selected_location: l.formattedAddress,
          scan_scope: data.scanScope,
          trading_name: data.tradingName ?? null,
          parent_company: data.parentCompany ?? null,
          previous_names: data.previousNames,
          abbreviations: data.abbreviations,
          branch_names: data.branchNames,
          executives: data.executives,
          products: data.products,
          confirmed_at: new Date().toISOString(),
          locked: true,
        },
        { onConflict: "user_id,google_place_id" },
      )
      .select("id")
      .maybeSingle();

    if (error || !profile) {
      throw new Error(error?.message ?? "Could not save the business profile.");
    }

    await supabase.from("business_place_selections").insert({
      user_id: userId,
      business_profile_id: profile.id,
      google_place_id: l.placeId,
      display_name: l.name,
      formatted_address: l.formattedAddress,
      raw: l.raw,
      scan_scope: data.scanScope,
    });

    const aliases = buildAliases(identity);
    const queries = buildQueryPlan(identity);

    await supabase.from("business_aliases").delete().eq("business_profile_id", profile.id);
    await supabase.from("business_scan_queries").delete().eq("business_profile_id", profile.id);

    if (aliases.length) {
      await supabase.from("business_aliases").insert(
        aliases.map((a) => ({
          user_id: userId,
          business_profile_id: profile.id,
          alias: a.alias,
          alias_type: a.aliasType,
        })),
      );
    }

    if (queries.length) {
      await supabase.from("business_scan_queries").insert(
        queries.slice(0, 400).map((q) => ({
          user_id: userId,
          business_profile_id: profile.id,
          query: q.query,
          query_type: q.queryType,
          priority: q.priority,
          country: q.country ?? null,
        })),
      );
    }

    return {
      businessProfileId: profile.id as string,
      aliases,
      queries,
    };
  });

/** Loads a saved business identity profile with its aliases and query plan. */
export const getBusinessProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ businessProfileId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("business_profiles")
      .select("*")
      .eq("id", data.businessProfileId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile) return { profile: null, aliases: [], queries: [] };

    const [{ data: aliases }, { data: queries }] = await Promise.all([
      supabase
        .from("business_aliases")
        .select("alias, alias_type")
        .eq("user_id", userId)
        .eq("business_profile_id", data.businessProfileId),
      supabase
        .from("business_scan_queries")
        .select("query, query_type, priority, country")
        .eq("user_id", userId)
        .eq("business_profile_id", data.businessProfileId)
        .order("priority", { ascending: false }),
    ]);

    return { profile, aliases: aliases ?? [], queries: queries ?? [] };
  });

/** Recent business profiles for the signed-in user. */
export const listBusinessProfiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("business_profiles")
      .select("id, official_business_name, address, city, country, scan_scope, confirmed_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    return { profiles: data ?? [] };
  });
