/**
 * Pure identity-profile helpers for the Business Reputation Scan module.
 * No imports, no side effects — safe on client and server, easy to test.
 */

export type ScanScope = "branch" | "brand";

export interface BusinessIdentityInput {
  officialName: string;
  tradingName?: string | null;
  parentCompany?: string | null;
  previousNames?: string[];
  abbreviations?: string[];
  branchNames?: string[];
  executives?: string[];
  products?: string[];
  city?: string | null;
  region?: string | null;
  country?: string | null;
  category?: string | null;
  industry?: string | null;
  websiteDomain?: string | null;
  scope?: ScanScope;
}

export interface BusinessAlias {
  alias: string;
  aliasType:
    | "official"
    | "trading"
    | "parent"
    | "previous"
    | "abbreviation"
    | "branch"
    | "misspelling"
    | "handle";
}

export interface GeneratedQuery {
  query: string;
  queryType:
    | "identity"
    | "defamation"
    | "fraud"
    | "impersonation"
    | "review"
    | "legal"
    | "media"
    | "social";
  priority: number;
  country?: string | null;
}

const STOP_TOKENS = new Set([
  "pvt",
  "pvt.",
  "private",
  "ltd",
  "ltd.",
  "limited",
  "llp",
  "inc",
  "inc.",
  "llc",
  "co",
  "co.",
  "company",
  "corporation",
  "corp",
  "the",
  "and",
  "&",
]);

export function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** "Bright Star Dental Pvt Ltd" -> "BSD" (only when >= 2 meaningful words). */
export function initialsOf(name: string): string | null {
  const words = normalizeName(name)
    .split(/[\s-]+/)
    .filter((w) => w && !STOP_TOKENS.has(w.toLowerCase()));
  if (words.length < 2) return null;
  const letters = words
    .map((w) => w[0])
    .filter((c): c is string => Boolean(c) && /[a-z0-9]/i.test(c))
    .join("")
    .toUpperCase();
  return letters.length >= 2 ? letters : null;
}

/** Cheap, deterministic misspelling variants (spacing / hyphen / duplicate letters). */
export function misspellingVariants(name: string): string[] {
  const base = normalizeName(name);
  const out = new Set<string>();
  if (base.includes(" ")) {
    out.add(base.replace(/\s+/g, ""));
    out.add(base.replace(/\s+/g, "-"));
  }
  if (base.includes("-")) out.add(base.replace(/-/g, " "));
  return Array.from(out).filter((v) => v.toLowerCase() !== base.toLowerCase());
}

export function buildAliases(input: BusinessIdentityInput): BusinessAlias[] {
  const seen = new Set<string>();
  const out: BusinessAlias[] = [];

  const push = (raw: string | null | undefined, aliasType: BusinessAlias["aliasType"]) => {
    const alias = normalizeName(raw ?? "");
    if (!alias) return;
    const key = `${aliasType}::${alias.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ alias, aliasType });
  };

  push(input.officialName, "official");
  push(input.tradingName, "trading");
  push(input.parentCompany, "parent");
  for (const n of input.previousNames ?? []) push(n, "previous");
  for (const a of input.abbreviations ?? []) push(a, "abbreviation");
  for (const b of input.branchNames ?? []) push(b, "branch");

  const initials = initialsOf(input.officialName);
  if (initials) push(initials, "abbreviation");

  for (const variant of misspellingVariants(input.officialName)) {
    push(variant, "misspelling");
  }

  const domain = (input.websiteDomain ?? "").replace(/^www\./i, "");
  if (domain) {
    const handle = domain.split(".")[0];
    if (handle && handle.length > 2) push(handle, "handle");
  }

  return out;
}

const DEFAMATION_TERMS = [
  "scam",
  "fraud",
  "fake",
  "cheated",
  "complaint",
  "warning",
  "avoid",
  "exposed",
  "lawsuit",
  "police complaint",
];

const REVIEW_TERMS = ["reviews", "customer complaints", "bad experience", "refund not given"];
const IMPERSONATION_TERMS = ["official page", "fake account", "clone website", "duplicate branch"];

/**
 * Deterministic, de-duplicated query plan. Branch scope keeps the location
 * qualifier on every phrase; brand scope drops it so all locations are covered.
 */
export function buildQueryPlan(input: BusinessIdentityInput): GeneratedQuery[] {
  const scope: ScanScope = input.scope ?? "branch";
  const locality = [input.city, input.region].filter(Boolean).join(" ").trim();
  const location = scope === "branch" ? locality : "";
  const country = input.country ?? null;

  const names = Array.from(
    new Set(
      buildAliases(input)
        .filter((a) => a.aliasType !== "misspelling" && a.aliasType !== "handle")
        .map((a) => a.alias),
    ),
  ).slice(0, 6);

  const queries: GeneratedQuery[] = [];
  const seen = new Set<string>();
  const add = (parts: Array<string | null | undefined>, queryType: GeneratedQuery["queryType"], priority: number) => {
    const query = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!query) return;
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push({ query, queryType, priority, country });
  };

  for (const name of names) {
    add([name, location], "identity", 95);
    add([name, location, "news"], "media", 70);
    for (const term of DEFAMATION_TERMS) add([name, term, location], "defamation", 90);
    for (const term of REVIEW_TERMS) add([name, term, location], "review", 65);
    for (const term of IMPERSONATION_TERMS) add([name, term, location], "impersonation", 80);
    add([name, "court case"], "legal", 75);
    add([name, "consumer forum complaint"], "legal", 75);
    add([name, "money not refunded"], "fraud", 85);
  }

  for (const exec of (input.executives ?? []).slice(0, 5)) {
    add([exec, input.officialName], "identity", 60);
    add([exec, "allegations"], "defamation", 70);
  }

  for (const product of (input.products ?? []).slice(0, 5)) {
    add([product, input.officialName, "complaint"], "review", 55);
  }

  if (input.websiteDomain) add([input.websiteDomain, "complaint"], "review", 60);

  return queries.sort((a, b) => b.priority - a.priority);
}

export function summarizeQueryPlan(queries: GeneratedQuery[]): Array<{ queryType: string; count: number }> {
  const counts = new Map<string, number>();
  for (const q of queries) counts.set(q.queryType, (counts.get(q.queryType) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([queryType, count]) => ({ queryType, count }))
    .sort((a, b) => b.count - a.count);
}
