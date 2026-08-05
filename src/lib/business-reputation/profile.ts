export type BusinessScope = "branch" | "brand";

export type BusinessProfile = {
  resolved: boolean;
  resolvedBrandName: string;
  placeId: string;
  website: string | null;
  formattedAddress: string | null;
  country: string | null;
  city: string | null;
  businessTypes: string[];
  aliases: string[];
  scope: BusinessScope;
  isSample?: boolean;
};

export function normalizeWebsite(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return `https://${url.hostname.replace(/^www\./i, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

export function dedupeAliases(values: Array<string | null | undefined>, primary: string): string[] {
  const seen = new Set<string>([primary.trim().toLocaleLowerCase()]);
  const aliases: string[] = [];
  for (const value of values) {
    const clean = value?.trim().replace(/\s+/g, " ");
    if (!clean) continue;
    const key = clean.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(clean);
  }
  return aliases;
}

export function normalizeBusinessProfile(
  input: Omit<BusinessProfile, "aliases"> & {
    aliases?: string[];
    tradingNames?: string[];
    website?: string | null;
  },
): BusinessProfile {
  const aliases = dedupeAliases(
    [...(input.aliases ?? []), ...(input.tradingNames ?? [])],
    input.resolvedBrandName,
  );
  return {
    ...input,
    website: normalizeWebsite(input.website),
    aliases,
    businessTypes: [...new Set(input.businessTypes.map((x) => x.trim()).filter(Boolean))],
  };
}
