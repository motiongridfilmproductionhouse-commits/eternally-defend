import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  Search,
  Loader2,
  MapPin,
  Globe,
  Phone,
  Star,
  CheckCircle2,
  ShieldCheck,
  ListFilter,
  Layers,
  Info,
} from "lucide-react";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import {
  searchBusinesses,
  confirmBusinessSelection,
} from "@/lib/business-reputation/business.functions";
import {
  summarizeQueryPlan,
  type BusinessAlias,
  type GeneratedQuery,
} from "@/lib/business-reputation/identity-profile";

interface Listing {
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
  raw: unknown;
}

const glass =
  "rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_rgba(2,8,23,0.45)]";

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function BusinessReputationScan() {
  const runSearch = useServerFn(searchBusinesses);
  const runConfirm = useServerFn(confirmBusinessSelection);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Listing | null>(null);
  const [scanScope, setScanScope] = useState<"branch" | "brand">("branch");
  const [tradingName, setTradingName] = useState("");
  const [parentCompany, setParentCompany] = useState("");
  const [previousNames, setPreviousNames] = useState("");
  const [abbreviations, setAbbreviations] = useState("");
  const [executives, setExecutives] = useState("");
  const [products, setProducts] = useState("");
  const [industry, setIndustry] = useState("");

  const search = useMutation({
    mutationFn: (q: string) => runSearch({ data: { query: q } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const confirm = useMutation({
    mutationFn: (listing: Listing) =>
      runConfirm({
        data: {
          listing: listing as never,
          scanScope,
          tradingName: tradingName.trim() || undefined,
          parentCompany: parentCompany.trim() || undefined,
          previousNames: splitList(previousNames),
          abbreviations: splitList(abbreviations),
          branchNames: [],
          executives: splitList(executives),
          products: splitList(products),
          industry: industry.trim() || undefined,
        },
      }),
    onSuccess: () => toast.success("Business identity locked. Query plan generated."),
    onError: (e: Error) => toast.error(e.message),
  });

  const listings = (search.data?.listings ?? []) as Listing[];
  const provider = search.data?.provider;
  const aliases = (confirm.data?.aliases ?? []) as BusinessAlias[];
  const queries = (confirm.data?.queries ?? []) as GeneratedQuery[];
  const planSummary = useMemo(() => summarizeQueryPlan(queries), [queries]);

  return (
    <div className="space-y-5">
      <PageCard
        title="Business Reputation Scan"
        sub="Select a verified business, lock its identity, and generate the reputation query plan."
        actions={<Pill>Phase 1 · Identity foundation</Pill>}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p>
              This module is only for businesses — it never mixes with celebrity, personal
              reputation, deepfake or copyright scans. Business listings come from Google Places once
              a Google Maps connection is linked; until then, clearly-labelled sample listings let
              you exercise the full selection and confirmation flow.
            </p>
          </div>

          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const q = query.trim();
              if (q.length < 2) {
                toast.error("Enter at least 2 characters.");
                return;
              }
              setSelected(null);
              confirm.reset();
              search.mutate(q);
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search business name, e.g. Bright Star Dental Clinic Kochi"
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm outline-none backdrop-blur focus:border-primary/50"
              />
            </div>
            <button
              type="submit"
              disabled={search.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {search.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Find business
            </button>
          </form>

          {provider === "sample" && listings.length > 0 && (
            <p className="text-[11px] uppercase tracking-wider text-amber-400/90">
              Sample listings — connect Google Maps for live verified businesses
            </p>
          )}

          {listings.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {listings.map((l) => {
                const active = selected?.placeId === l.placeId;
                return (
                  <button
                    key={l.placeId}
                    type="button"
                    onClick={() => {
                      setSelected(l);
                      confirm.reset();
                    }}
                    className={`${glass} p-3 text-left transition ${
                      active ? "border-primary/60 ring-1 ring-primary/40" : "hover:border-white/25"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{l.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {l.formattedAddress}
                        </p>
                      </div>
                      {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {l.category && <span className="rounded-md bg-white/5 px-2 py-0.5">{l.category}</span>}
                      {typeof l.rating === "number" && (
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3 w-3 text-amber-400" />
                          {l.rating.toFixed(1)}
                          {l.reviewCount ? ` · ${l.reviewCount}` : ""}
                        </span>
                      )}
                      {l.websiteDomain && (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="h-3 w-3" />
                          {l.websiteDomain}
                        </span>
                      )}
                      {l.isSample && (
                        <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-amber-300">
                          sample
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PageCard>

      {selected && (
        <PageCard
          title="Confirm business identity"
          sub="Everything below feeds the query plan. Confirm before any scanning begins."
          actions={<Pill>{confirm.data ? "Locked" : "Awaiting confirmation"}</Pill>}
        >
          <div className="space-y-4">
            <div className={`${glass} p-4`}>
              <p className="text-base font-semibold">{selected.name}</p>
              <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <span className="inline-flex items-start gap-2">
                  <MapPin className="mt-0.5 h-3.5 w-3.5" />
                  {selected.formattedAddress || "No address"}
                </span>
                <span className="inline-flex items-start gap-2">
                  <Phone className="mt-0.5 h-3.5 w-3.5" />
                  {selected.phone ?? "No phone on listing"}
                </span>
                <span className="inline-flex items-start gap-2">
                  <Globe className="mt-0.5 h-3.5 w-3.5" />
                  {selected.websiteDomain ?? "No website on listing"}
                </span>
                <span className="inline-flex items-start gap-2">
                  <Layers className="mt-0.5 h-3.5 w-3.5" />
                  {selected.businessStatus ?? "Status unknown"}
                </span>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Scan scope
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["branch", "This location only", "Keeps the city qualifier on every query"],
                    ["brand", "Entire brand", "Covers all locations, drops the city qualifier"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScanScope(value)}
                    className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                      scanScope === value
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/25"
                    }`}
                  >
                    <span className="block font-semibold">{label}</span>
                    <span className="block text-[11px] opacity-80">{hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Trading / brand name" value={tradingName} onChange={setTradingName} placeholder="Optional" />
              <Field label="Parent company" value={parentCompany} onChange={setParentCompany} placeholder="Optional" />
              <Field label="Industry" value={industry} onChange={setIndustry} placeholder="e.g. Healthcare" />
              <Field
                label="Abbreviations"
                value={abbreviations}
                onChange={setAbbreviations}
                placeholder="Comma separated"
              />
              <Field
                label="Previous names"
                value={previousNames}
                onChange={setPreviousNames}
                placeholder="Comma separated"
              />
              <Field
                label="Key executives"
                value={executives}
                onChange={setExecutives}
                placeholder="Comma separated"
              />
              <Field
                label="Products / services"
                value={products}
                onChange={setProducts}
                placeholder="Comma separated"
              />
            </div>

            <button
              type="button"
              disabled={confirm.isPending}
              onClick={() => selected && confirm.mutate(selected)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {confirm.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Confirm business & build query plan
            </button>
          </div>
        </PageCard>
      )}

      {confirm.data && (
        <PageCard
          title="Identity profile & query plan"
          sub={`${aliases.length} name variants · ${queries.length} generated search phrases`}
          actions={<Pill>Ready for discovery</Pill>}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {planSummary.map((s) => (
                <span
                  key={s.queryType}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                  {s.queryType} · <span className="text-foreground">{s.count}</span>
                </span>
              ))}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Name variants
              </p>
              <div className="flex flex-wrap gap-1.5">
                {aliases.map((a) => (
                  <span
                    key={`${a.aliasType}-${a.alias}`}
                    className="rounded-md bg-white/5 px-2 py-0.5 text-[11px]"
                    title={a.aliasType}
                  >
                    {a.alias}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Generated search phrases (top 40)
              </p>
              <div className={`${glass} max-h-72 overflow-auto p-2`}>
                <ul className="divide-y divide-white/5 text-xs">
                  {queries.slice(0, 40).map((q) => (
                    <li key={q.query} className="flex items-center justify-between gap-3 px-2 py-1.5">
                      <span className="truncate">{q.query}</span>
                      <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {q.queryType}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </PageCard>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm outline-none backdrop-blur focus:border-primary/50"
      />
    </label>
  );
}
