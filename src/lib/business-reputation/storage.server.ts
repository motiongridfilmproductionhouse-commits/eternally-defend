/* eslint-disable @typescript-eslint/no-explicit-any */
import { businessFindingKey } from "./historical.server";

export async function persistBusinessProfile(input: {
  supabase: any;
  userId: string;
  scanId: string;
  profile: any;
}) {
  const { data, error } = await input.supabase
    .from("business_reputation_profiles")
    .upsert(
      {
        user_id: input.userId,
        places_place_id: input.profile.placeId,
        selected_name: input.profile.resolvedBrandName,
        normalized_domain: input.profile.website
          ? new URL(input.profile.website).hostname.replace(/^www\./i, "").toLowerCase()
          : null,
        scope: input.profile.scope || "brand",
        profile: input.profile,
      },
      { onConflict: "user_id,places_place_id" },
    )
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message || "Business profile persistence failed");
  const { error: scanError } = await input.supabase
    .from("scans")
    .update({ business_profile_id: data.id })
    .eq("id", input.scanId)
    .eq("user_id", input.userId)
    .eq("scan_type", "business_reputation");
  if (scanError) throw new Error(scanError.message);
  return data.id as string;
}

export async function persistBusinessFinding(input: {
  supabase: any;
  scanId: string;
  userId: string;
  businessProfileId: string;
  row: any;
  infrastructure: any;
  reporting: any;
}) {
  const findingKey = businessFindingKey({
    source: input.row.source,
    externalId: input.row.external_id,
    url: input.row.canonical_url,
  });
  const { data: previous } = await input.supabase
    .from("business_reputation_findings")
    .select(
      "id,first_scan_id,first_detected_at,last_checked_at,state,severity,engagement,canonical_url,times_detected",
    )
    .eq("user_id", input.userId)
    .eq("business_profile_id", input.businessProfileId)
    .eq("finding_key", findingKey)
    .maybeSingle();
  const checkedAt = new Date().toISOString();
  const changed = Boolean(
    previous &&
    (previous.canonical_url !== input.row.canonical_url ||
      previous.severity !== input.row.severity),
  );
  const state =
    previous?.state === "removed"
      ? "reappeared"
      : changed
        ? "changed"
        : previous
          ? "active"
          : "new";
  const payload = {
    source: input.row.source,
    external_id: input.row.external_id || null,
    canonical_url: input.row.canonical_url,
    permalink: input.row.permalink || input.row.canonical_url,
    title: input.row.title || null,
    description: input.row.description || null,
    author: input.row.author || null,
    thumbnail_url: input.row.thumbnail_url || null,
    published_at: input.row.published_at || null,
    engagement: input.row.engagement || null,
    threat_score: input.row.threat_score || null,
    severity: input.row.severity || null,
    risk_type: input.row.risk_type || null,
    tags: input.row.tags || [],
    metrics: input.row.metrics || {},
    user_id: input.userId,
    business_profile_id: input.businessProfileId,
    scan_id: input.scanId,
    finding_key: findingKey,
    state,
    first_detected_at: previous?.first_detected_at || checkedAt,
    last_checked_at: checkedAt,
    removed_at: null,
    first_scan_id: previous?.first_scan_id || input.scanId,
    last_seen_scan_id: input.scanId,
    times_detected: (previous?.times_detected || 0) + 1,
  };
  const { data: finding, error } = await input.supabase
    .from("business_reputation_findings")
    .upsert(payload, { onConflict: "user_id,business_profile_id,finding_key" })
    .select("id")
    .single();
  if (error || !finding?.id)
    throw new Error(error?.message || "Business finding persistence failed");

  await input.supabase.from("business_reputation_infrastructure_details").upsert(
    {
      user_id: input.userId,
      finding_id: finding.id,
      business_profile_id: input.businessProfileId,
      scan_id: input.scanId,
      domain: input.infrastructure?.domain || new URL(input.row.canonical_url).hostname,
      status:
        input.infrastructure?.unavailable_fields &&
        Object.keys(input.infrastructure.unavailable_fields).length
          ? "partial"
          : "complete",
      registrar: input.infrastructure?.registrar || null,
      rdap_url: input.infrastructure?.rdap_url || null,
      whois_data: input.infrastructure?.whois_data || null,
      hosting_provider: input.infrastructure?.hosting_provider || null,
      hosting_abuse_email: input.infrastructure?.hosting_abuse_email || null,
      registrar_abuse_email: input.infrastructure?.registrar_abuse_email || null,
      asn: input.infrastructure?.asn || null,
      ip_addresses:
        input.infrastructure?.ip_addresses || input.infrastructure?.dns?.addresses || [],
      dns_provider: input.infrastructure?.dns_provider || null,
      nameservers: input.infrastructure?.dns?.nameservers || [],
      cdn: input.infrastructure?.cdn || null,
      country: input.infrastructure?.country || null,
      website_contact_page: input.infrastructure?.contact_page || null,
      unavailable_fields: input.infrastructure?.unavailable_fields || {},
      platform_reporting_url: input.reporting?.reporting_path || null,
    },
    { onConflict: "finding_id,scan_id" },
  );
  const routes = Array.isArray(input.reporting?.routes) ? input.reporting.routes : [];
  if (routes.length) {
    await input.supabase.from("business_reputation_reporting_routes").upsert(
      routes.map((route: any) => ({
        ...route,
        user_id: input.userId,
        finding_id: finding.id,
        business_profile_id: input.businessProfileId,
        scan_id: input.scanId,
        route_type: route.route_type || route.type,
        reporting_url: route.reporting_url || route.url || null,
        draft_body: route.draft_body || "Draft requires human review.",
        human_approval_required: true,
      })),
      { onConflict: "finding_id,scan_id,route_type" },
    );
  }
  await input.supabase.from("business_reputation_finding_statements").upsert(
    {
      user_id: input.userId,
      finding_id: finding.id,
      business_profile_id: input.businessProfileId,
      scan_id: input.scanId,
      statement_type: "classification",
      statement: input.row.risk_type || "General mention",
      confidence: input.row.metrics?.relevance_score || null,
      explanation: input.row.metrics?.classification_explanation || null,
    },
    { onConflict: "finding_id,scan_id,statement_type,statement" },
  );
  return { id: finding.id, previous, state };
}

export async function loadBusinessBaseline(input: {
  supabase: any;
  userId: string;
  profileId: string;
  scanId: string;
}) {
  const { data } = await input.supabase
    .from("business_reputation_findings")
    .select("id,finding_key,scan_id,canonical_url,severity,engagement,state")
    .eq("user_id", input.userId)
    .eq("business_profile_id", input.profileId)
    .neq("scan_id", input.scanId)
    .neq("state", "removed");
  return data || [];
}

export async function markBusinessRemoved(input: {
  supabase: any;
  scanId: string;
  userId: string;
  profileId: string;
  seenKeys: Set<string>;
}) {
  const { data } = await input.supabase
    .from("business_reputation_findings")
    .select("id,finding_key")
    .eq("user_id", input.userId)
    .eq("business_profile_id", input.profileId)
    .neq("scan_id", input.scanId)
    .neq("state", "removed");
  const removed = (data || []).filter((row: any) => !input.seenKeys.has(row.finding_key));
  for (const row of removed) {
    await input.supabase
      .from("business_reputation_findings")
      .update({
        state: "removed",
        removed_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", input.userId);
  }
  return removed.length;
}
