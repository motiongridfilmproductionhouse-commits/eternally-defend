import { useState, type FormEvent } from "react";
import { ArrowRight, ChevronDown, Search } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { lookupIdentityImages, type StartScanPayload } from "@/lib/prospect/scan.functions";
import { viaProxy } from "@/lib/media-utils";
import { fmtDate, sanitizeProviderNames } from "./staff-model";

export interface ReadinessFamily {
  key: string;
  label: string;
  state: "available" | "unavailable" | "policy_disabled";
  reason: string | null;
  providers: string[];
}

export interface RecentScan {
  id: string;
  status: string;
  coverage_state: string | null;
  created_at: string;
  prospect_identities: { display_name: string; identity_type: string } | null;
}

const TYPES: Array<{ value: NonNullable<StartScanPayload["identityType"]>; label: string }> = [
  { value: "celebrity", label: "Celebrity" },
  { value: "public_figure", label: "Public Figure" },
  { value: "individual", label: "Individual" },
  { value: "executive", label: "Executive" },
  { value: "brand", label: "Brand" },
  { value: "company", label: "Company" },
  { value: "organization", label: "Organization" },
];

const splitList = (v: string) =>
  v
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export function StaffSearch({
  readiness,
  detector,
  recent,
  starting,
  error,
  onStart,
  onOpenScan,
}: {
  readiness: ReadinessFamily[] | null;
  detector: string | null | undefined;
  recent: RecentScan[];
  starting: boolean;
  error: string | null;
  onStart: (payload: StartScanPayload) => void;
  onOpenScan: (scanId: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<NonNullable<StartScanPayload["identityType"]>>("public_figure");
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState("");
  const [profile, setProfile] = useState("");
  const [website, setWebsite] = useState("");
  const [profession, setProfession] = useState("");
  const [organization, setOrganization] = useState("");
  const [works, setWorks] = useState("");
  const [entities, setEntities] = useState("");
  const [aliases, setAliases] = useState("");
  const [handles, setHandles] = useState("");
  const [ambiguous, setAmbiguous] = useState(false);

  const lookup = useServerFn(lookupIdentityImages);
  const [confirm, setConfirm] = useState<null | {
    loading: boolean;
    images: Array<{ url: string; page: string; title: string }>;
  }>(null);
  const [pick, setPick] = useState(0);
  const [blurry, setBlurry] = useState<Set<string>>(new Set());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || starting || confirm) return;
    setPick(0);
    setBlurry(new Set());
    setConfirm({ loading: true, images: [] });
    try {
      const res = await lookup({ data: { name: name.trim(), hint: profession || null } });
      setConfirm({ loading: false, images: res.images });
    } catch {
      setConfirm({ loading: false, images: [] });
    }
  };

  // Drop images that load below a clear-resolution threshold.
  const rejectIfSmall = (url: string) => (ev: React.SyntheticEvent<HTMLImageElement>) => {
    const img = ev.currentTarget;
    if (img.naturalWidth > 0 && img.naturalWidth < 240) {
      setBlurry((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
    }
  };

  const launch = () => {
    setConfirm(null);
    onStart({
      name: name.trim(),
      identityType: type,
      countryRegion: country || null,
      knownProfileUrl: profile || null,
      knownWebsite: website || null,
      profession: profession || null,
      organization: organization || null,
      knownWorks: splitList(works),
      linkedEntities: splitList(entities),
      aliases: splitList(aliases),
      knownHandles: splitList(handles).map((h) => h.replace(/^@/, "")),
      nameIsAmbiguous: ambiguous,
    });
  };

  const shown = (confirm?.images ?? [])
    .map((i) => ({ ...i, src: viaProxy(i.url) }))
    .filter((i): i is typeof i & { src: string } => Boolean(i.src))
    .filter((i) => !blurry.has(i.url) && !blurry.has(i.src));
  const main = shown[pick] ?? shown[0];

  const available = readiness?.filter((f) => f.state === "available").length ?? 0;

  return (
    <form className="sx-hero" onSubmit={submit} noValidate>
      {confirm ? (
        <div className="sx-confirm-backdrop" role="dialog" aria-modal="true" aria-label="Confirm identity">
          <div className="sx-confirm">
            <div className="sx-confirm-orb-wrap">
              <div className="sx-confirm-ring" aria-hidden="true" />
              <div className="sx-confirm-orb">
                {confirm.loading ? (
                  <div className="sx-confirm-loading">
                    <span className="sx-confirm-dots" aria-hidden="true"><i /><i /><i /></span>
                    Finding public images…
                  </div>
                ) : main ? (
                  <img key={main.url} src={main.src} alt={name} className="sx-confirm-main" />
                ) : (
                  <div className="sx-confirm-loading">No public image found</div>
                )}
              </div>
            </div>
            {!confirm.loading && shown.length > 1 ? (
              <div className="sx-confirm-mosaic" role="group" aria-label="Choose a different photo">
                {shown.slice(0, 6).map((img, i) => (
                  <button
                    key={img.url}
                    type="button"
                    aria-label={`Use image ${i + 1}`}
                    aria-pressed={i === pick}
                    onClick={() => setPick(i)}
                  >
                    <img src={img.src} alt="" loading="lazy" onError={(ev) => ((ev.currentTarget.parentElement as HTMLElement).style.display = "none")} />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="sx-eyebrow">Confirm identity</div>
            <h2 className="sx-confirm-title">Is this who you mean?</h2>
            <p className="sx-confirm-name">{name.trim()}</p>
            <p className="sx-confirm-note">
              Images are for confirmation only and are not used as evidence.
            </p>
            <div className="sx-confirm-actions">
              <button type="button" className="sx-btn ghost" onClick={() => setConfirm(null)}>
                Not this person
              </button>
              <button
                type="button"
                className="sx-btn primary"
                disabled={confirm.loading || starting}
                onClick={launch}
              >
                Confirm &amp; start scan <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="sx-eyebrow">Pre-enrollment · Public-source intelligence</div>
      <h1 className="sx-display">Identity Intelligence Scan</h1>
      <p>Search an artist, public figure, executive, organization or brand before enrollment.</p>

      <div className="sx-search">
        <div className="sx-search-inner">
          <Search size={20} color="#56607a" aria-hidden="true" />
          <input
            id="sx-name"
            aria-label="Artist, person or brand name"
            placeholder="Enter artist, public figure, company or brand"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          <button
            type="submit"
            className="sx-btn primary lg"
            disabled={name.trim().length < 2 || starting || Boolean(confirm?.loading)}
          >
            {starting ? "Starting…" : confirm?.loading ? "Finding…" : "Start Live Scan"}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>

      <div className="sx-seg" role="group" aria-label="Identity type">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={type === t.value}
            onClick={() => setType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="sx-refine">
        <button
          type="button"
          className="sx-btn ghost sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevronDown
            size={15}
            style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .3s" }}
          />
          Refine identity (recommended for common names)
        </button>
        {open ? (
          <div className="sx-fields sx-view">
            <Field
              id="sx-country"
              label="Country / region"
              value={country}
              onChange={setCountry}
              placeholder="e.g. India · Kerala"
            />
            <Field
              id="sx-profession"
              label="Profession"
              value={profession}
              onChange={setProfession}
              placeholder="e.g. film actor"
            />
            <Field
              id="sx-profile"
              label="Known official profile"
              value={profile}
              onChange={setProfile}
              placeholder="https://instagram.com/…"
              hint="Its handle is treated as official."
            />
            <Field
              id="sx-website"
              label="Official website"
              value={website}
              onChange={setWebsite}
              placeholder="https://…"
            />
            <Field
              id="sx-handles"
              label="Other official handles"
              value={handles}
              onChange={setHandles}
              placeholder="@handle, @handle"
              hint="Profiles using the name that are not listed here are flagged for ownership review."
            />
            <Field
              id="sx-org"
              label="Organization / company"
              value={organization}
              onChange={setOrganization}
              placeholder="Label, studio, company"
            />
            <Field
              id="sx-works"
              label="Known works"
              value={works}
              onChange={setWorks}
              placeholder="Titles, films, albums — comma separated"
              hint="Strong identity signal."
            />
            <Field
              id="sx-entities"
              label="Linked entities"
              value={entities}
              onChange={setEntities}
              placeholder="Co-stars, companies, labels — comma separated"
              hint="Strong identity signal."
            />
            <Field
              id="sx-aliases"
              label="Aliases"
              value={aliases}
              onChange={setAliases}
              placeholder="Stage names, spellings"
            />
            <label
              className="sx-field"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                alignSelf: "end",
                fontSize: 13,
                color: "var(--sx-ink-2)",
              }}
            >
              <input
                type="checkbox"
                checked={ambiguous}
                onChange={(e) => setAmbiguous(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              This is a common name — apply strict identity matching
            </label>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="sx-note warn" style={{ maxWidth: 760, margin: "18px auto 0" }} role="alert">
          {error}
        </div>
      ) : null}

      <div className="sx-readiness" aria-label="Source readiness">
        {(readiness ?? []).map((f) => (
          <span
            key={f.key}
            className="sx-src"
            data-state={f.state}
            title={
              f.reason
                ? sanitizeProviderNames(f.reason)
                : sanitizeProviderNames(f.providers.join(" · "))
            }
          >
            <span className="d" />
            {f.label}
            <span className="st">
              {f.state === "available"
                ? "Ready"
                : f.state === "policy_disabled"
                  ? "Policy off"
                  : "Not scanned"}
            </span>
          </span>
        ))}
      </div>
      {readiness ? (
        <p style={{ fontSize: 12.5, marginTop: 12 }}>
          {available} of {readiness.filter((f) => f.state !== "policy_disabled").length} source
          families can be queried in this environment · AI-manipulation analysis:{" "}
          {detector ? detector : "not configured"}
        </p>
      ) : null}

      {recent.length ? (
        <div className="sx-recent">
          <div className="sx-eyebrow" style={{ marginBottom: 8, textAlign: "left" }}>
            Recent pre-enrollment scans
          </div>
          {recent.map((r) => (
            <button
              key={r.id}
              type="button"
              className="sx-recent-row"
              onClick={() => onOpenScan(r.id)}
            >
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {r.prospect_identities?.display_name ?? "—"}
              </span>
              <span
                className={`sx-chip ${r.status === "running" || r.status === "queued" ? "c-cyan c-live" : r.status === "failed" ? "c-risk" : "c-mute"}`}
              >
                <span className="d" />
                {r.status}
                {r.coverage_state ? ` · ${r.coverage_state.toLowerCase()}` : ""}
              </span>
              <span className="sx-mono" style={{ fontSize: 11.5, color: "var(--sx-faint)" }}>
                {fmtDate(r.created_at)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="sx-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
