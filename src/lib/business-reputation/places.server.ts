/**
 * Business listing provider for the Business Reputation Scan module.
 *
 * When a Google Maps Platform connection is linked, this calls Places API (New)
 * through the Lovable connector gateway. Until then it returns clearly labelled
 * sample listings so the selection + confirmation flow is fully testable.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export interface BusinessListing {
  placeId: string;
  name: string;
  formattedAddress: string;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  category?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  websiteDomain?: string | null;
  googleMapsUrl?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  businessStatus?: string | null;
  isSample: boolean;
  raw: Record<string, unknown>;
}

export function placesConfigured(): boolean {
  return Boolean(process.env["GOOGLE_MAPS_API_KEY"] && process.env["LOVABLE_API_KEY"]);
}

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function splitAddress(address: string): { city: string | null; region: string | null; country: string | null } {
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    city: parts.length >= 3 ? (parts[parts.length - 3] ?? null) : (parts[0] ?? null),
    region: parts.length >= 2 ? (parts[parts.length - 2] ?? null) : null,
    country: parts.length >= 1 ? (parts[parts.length - 1] ?? null) : null,
  };
}

interface PlacesTextSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    primaryTypeDisplayName?: { text?: string };
    nationalPhoneNumber?: string;
    websiteUri?: string;
    googleMapsUri?: string;
    rating?: number;
    userRatingCount?: number;
    businessStatus?: string;
  }>;
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryTypeDisplayName",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
].join(",");

function sampleListings(query: string): BusinessListing[] {
  const base = query.trim() || "Sample Business";
  const cities: Array<[string, string, string]> = [
    ["Kochi", "Kerala", "India"],
    ["Bengaluru", "Karnataka", "India"],
    ["Chennai", "Tamil Nadu", "India"],
  ];
  return cities.map(([city, region, country], index) => {
    const address = `${12 + index * 7} Main Road, ${city}, ${region}, ${country}`;
    return {
      placeId: `sample:${base.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${index}`,
      name: index === 0 ? base : `${base} — ${city} Branch`,
      formattedAddress: address,
      city,
      region,
      country,
      latitude: null,
      longitude: null,
      category: "Business (sample data)",
      phone: null,
      websiteUrl: null,
      websiteDomain: null,
      googleMapsUrl: null,
      rating: 4.1 + index * 0.2,
      reviewCount: 48 + index * 31,
      businessStatus: "OPERATIONAL",
      isSample: true,
      raw: { sample: true, query: base },
    } satisfies BusinessListing;
  });
}

export async function searchBusinessListings(query: string): Promise<{
  listings: BusinessListing[];
  provider: "google_places" | "sample";
}> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { listings: [], provider: placesConfigured() ? "google_places" : "sample" };

  if (!placesConfigured()) {
    return { listings: sampleListings(trimmed), provider: "sample" };
  }

  const response = await fetch(`${GATEWAY_URL}/places/v1/places:searchText`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      "X-Connection-Api-Key": String(process.env["GOOGLE_MAPS_API_KEY"]),
      "Content-Type": "application/json",
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: trimmed, maxResultCount: 10 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Business listing lookup failed [${response.status}]: ${body.slice(0, 400)}`);
  }

  const data = (await response.json()) as PlacesTextSearchResponse;
  const listings: BusinessListing[] = (data.places ?? [])
    .filter((p) => p.id && p.displayName?.text)
    .map((p) => {
      const address = p.formattedAddress ?? "";
      const parsed = splitAddress(address);
      return {
        placeId: String(p.id),
        name: String(p.displayName?.text),
        formattedAddress: address,
        city: parsed.city,
        region: parsed.region,
        country: parsed.country,
        latitude: p.location?.latitude ?? null,
        longitude: p.location?.longitude ?? null,
        category: p.primaryTypeDisplayName?.text ?? null,
        phone: p.nationalPhoneNumber ?? null,
        websiteUrl: p.websiteUri ?? null,
        websiteDomain: domainOf(p.websiteUri),
        googleMapsUrl: p.googleMapsUri ?? null,
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? null,
        businessStatus: p.businessStatus ?? null,
        isSample: false,
        raw: p as Record<string, unknown>,
      } satisfies BusinessListing;
    });

  return { listings, provider: "google_places" };
}
