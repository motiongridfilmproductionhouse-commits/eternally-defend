import type { BusinessProfile, BusinessScope } from "./profile";

export type BusinessQuery = { category: string; query: string; priority: number };

const CATEGORIES = [
  ["exact", (subject: string) => `"${subject}"`],
  ["identity", (subject: string) => `"${subject}" official`],
  ["media", (subject: string) => `"${subject}" news OR press OR interview`],
  ["review", (subject: string) => `"${subject}" review OR rating`],
  ["complaint", (subject: string) => `"${subject}" complaint OR scam OR fraud`],
  ["legal", (subject: string) => `"${subject}" lawsuit OR regulator OR fine`],
  ["impersonation", (subject: string) => `"${subject}" fake account OR impersonation`],
] as const;

export function buildBusinessQueryPlan(input: {
  profile: BusinessProfile;
  scope?: BusinessScope;
  handles?: string[];
  maxQueries?: number;
}): BusinessQuery[] {
  const { profile } = input;
  const scope = input.scope ?? profile.scope;
  const subject = profile.resolvedBrandName.trim();
  if (!profile.resolved || !subject) throw new Error("A confirmed business profile is required");
  const location = profile.city?.trim() || profile.formattedAddress?.split(",")[0]?.trim() || "";
  const suffix = scope === "branch" && location ? ` ${location}` : "";
  const candidates: BusinessQuery[] = [];
  for (const [category, factory] of CATEGORIES) {
    candidates.push({
      category,
      query: `${factory(subject)}${suffix}`,
      priority: category === "exact" ? 100 : 80 - candidates.length,
    });
  }
  for (const alias of profile.aliases)
    candidates.push({ category: "alias", query: `"${alias}"${suffix}`, priority: 70 });
  if (profile.website)
    candidates.push({
      category: "domain",
      query: `site:${new URL(profile.website).hostname} "${subject}"`,
      priority: 75,
    });
  for (const handle of input.handles ?? []) {
    const clean = handle.trim().replace(/^@/, "");
    if (clean)
      candidates.push({ category: "social", query: `"${clean}" "${subject}"`, priority: 65 });
  }
  const seen = new Set<string>();
  return candidates
    .filter((item) => {
      const key = item.query.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.priority - a.priority || a.query.localeCompare(b.query))
    .slice(0, input.maxQueries ?? 32);
}
