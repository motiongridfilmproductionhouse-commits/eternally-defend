import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
// Progress removed — using left-panel step indicator instead
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  addProtectedAsset, getOnboardingState, recordEnterpriseDocument, removeEnterpriseDocument,
  removeProtectedAsset, submitAuthorization, upsertClientProfile,
} from "@/lib/onboarding.functions";
import { refreshOnboardingYouTubeAsset, type YTChannel } from "@/lib/youtube.functions";
import { YouTubeChannelPicker, YouTubeAssetCard } from "@/components/onboarding/YouTubeChannelPicker";
import {
  AUTHORIZATION_LEVELS, CLIENT_TYPES, CONSENT_KEYS, CONSENT_TEXTS, ENTERPRISE_CLIENT_TYPES,
} from "@/lib/onboarding-versions";
import { CheckCircle2, Trash2, Upload, ChevronRight, ChevronLeft, ShieldCheck, User, Star, Video, Building2, Building, Users, Check } from "lucide-react";

type State = Awaited<ReturnType<typeof getOnboardingState>>;

const STEP_TITLES = [
  "Client Type",
  "Client Information",
  "Protected Assets",
  "Authorization & Consent",
  "Enforcement Authorization",
  "Digital Signature",
  "Authorization Vault",
  "Enterprise Documents",
];

export function OnboardingWizard({ initial }: { initial: State }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, setState] = useState<State>(initial);
  const [step, setStep] = useState<number>(Math.min(Math.max(initial.profile?.onboarding_step ?? 1, 1), 8));
  const [saving, setSaving] = useState(false);

  const upsert = useServerFn(upsertClientProfile);
  const addAsset = useServerFn(addProtectedAsset);
  const rmAsset = useServerFn(removeProtectedAsset);
  const submit = useServerFn(submitAuthorization);
  const recDoc = useServerFn(recordEnterpriseDocument);
  const rmDoc = useServerFn(removeEnterpriseDocument);
  const refresh = useServerFn(getOnboardingState);

  const profile = state.profile;
  const clientType = profile?.client_type ?? null;
  const isEnterprise = clientType ? ENTERPRISE_CLIENT_TYPES.has(clientType) : false;
  const totalSteps = isEnterprise ? 8 : 7;

  const reload = async () => setState(await refresh());

  const savePatch = async (patch: Record<string, unknown>, nextStep: number) => {
    setSaving(true);
    try {
      await upsert({ data: { step: nextStep, patch } });
      await reload();
      setStep(nextStep);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally { setSaving(false); }
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const stepIndex = Math.min(step, STEP_TITLES.length) - 1;
  const visibleSteps = STEP_TITLES.slice(0, totalSteps);

  return (
    <div className="fixed inset-0 flex flex-col lg:flex-row bg-[#050A18] overflow-hidden">
      {/* LEFT PANEL */}
      <aside className="relative lg:w-[45%] md:w-[40%] w-full lg:h-full h-auto overflow-hidden text-white flex flex-col justify-between p-8 md:p-12 lg:p-14"
        style={{
          background:
            "linear-gradient(135deg, #071B4A 0%, #1037A6 55%, #1E5EFF 100%)",
        }}
      >
        {/* radial glows */}
        <div className="pointer-events-none absolute -top-40 -left-32 size-[520px] rounded-full opacity-60"
          style={{ background: "radial-gradient(closest-side, rgba(96,165,250,0.35), transparent 70%)" }} />
        <div className="pointer-events-none absolute -bottom-52 -right-40 size-[620px] rounded-full opacity-50"
          style={{ background: "radial-gradient(closest-side, rgba(59,130,246,0.35), transparent 70%)" }} />
        <div className="pointer-events-none absolute right-16 top-40 size-56 rounded-full bg-cyan-400/10 blur-3xl animate-pulse" />

        {/* cyber grid */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at 30% 40%, black 40%, transparent 80%)",
          }}
        />

        {/* orbital rings */}
        <div className="pointer-events-none absolute -right-32 top-1/2 -translate-y-1/2 size-[520px] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-16 top-1/2 -translate-y-1/2 size-[360px] rounded-full border border-white/15" />
        <div className="pointer-events-none absolute right-24 top-1/2 -translate-y-1/2 size-[220px] rounded-full border border-white/10" />

        {/* glass overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.06] to-transparent" />

        {/* LOGO */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="size-10 rounded-xl grid place-items-center bg-white/15 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_rgba(30,94,255,0.35)]">
            <ShieldCheck className="size-5" />
          </div>
          <div className="font-display text-xl font-bold tracking-tight">Eterna AI</div>
        </div>

        {/* HERO + TIMELINE */}
        <div className="relative z-10 space-y-10 my-10 lg:my-0">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.28em] text-white/60">ENTERPRISE ONBOARDING</div>
            <h1 className="mt-3 font-display text-4xl md:text-5xl font-bold leading-[1.05] tracking-tight">
              Protect What's Yours.
            </h1>
            <p className="mt-3 text-lg font-medium text-white/90">Monitor. Detect. Enforce.</p>
            <p className="mt-4 text-sm leading-relaxed text-white/70 max-w-md">
              Protect your reputation, content, identity, brand assets and digital presence across
              YouTube, Instagram, TikTok, X, Reddit, websites and news platforms.
            </p>
          </div>

          <ol className="relative space-y-1 max-w-sm">
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-white/15" />
            {visibleSteps.map((title, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li key={title} className="relative flex items-center gap-4 py-2.5">
                  <span
                    className={`relative z-10 size-8 rounded-full grid place-items-center text-[11px] font-bold shrink-0 border transition-all duration-300 ${
                      current
                        ? "bg-white text-[#0b1f4d] border-white shadow-[0_0_0_6px_rgba(255,255,255,0.12),0_0_24px_rgba(96,165,250,0.6)]"
                        : done
                        ? "bg-emerald-400 text-[#0b1f4d] border-emerald-300"
                        : "bg-white/5 text-white/70 border-white/20 backdrop-blur"
                    }`}
                  >
                    {done ? <Check className="size-4" /> : i + 1}
                  </span>
                  <span className={`text-sm font-medium truncate transition-colors ${
                    current ? "text-white" : done ? "text-white/80" : "text-white/50"
                  }`}>{title}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative z-10 text-xs text-white/50">
          Step {step} of {totalSteps} · Encrypted &amp; legally binding
        </div>
      </aside>

      {/* RIGHT PANEL */}
      <section className="dark relative flex-1 lg:h-full h-auto overflow-y-auto bg-[#050A18] text-white">
        {/* subtle backdrop accents */}
        <div className="pointer-events-none absolute top-0 right-0 size-[500px] rounded-full opacity-30"
          style={{ background: "radial-gradient(closest-side, rgba(59,130,246,0.15), transparent 70%)" }} />
        <div className="pointer-events-none absolute bottom-0 left-0 size-[400px] rounded-full opacity-20"
          style={{ background: "radial-gradient(closest-side, rgba(37,99,235,0.15), transparent 70%)" }} />

        <div className="relative min-h-full flex flex-col justify-center px-6 md:px-12 lg:px-16 py-14 md:py-20">
          <div className="mx-auto w-full max-w-[700px]">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold tracking-[0.24em] text-blue-400">
                  STEP {step} / {totalSteps}
                </div>
                <h2 className="mt-2 font-display text-3xl md:text-4xl font-bold tracking-tight">{STEP_TITLES[step - 1]}</h2>
              </div>
              {profile?.onboarding_completed && (
                <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">Completed</Badge>
              )}
            </div>

            <div key={step} className="animate-fade-in">
              {step === 1 && <Step1 profile={profile} onNext={(v, acct) => savePatch({ client_type: v, account_type: acct }, 2)} saving={saving} />}
              {step === 2 && <Step2 profile={profile} isEnterprise={isEnterprise} onBack={goBack} onNext={(patch) => savePatch(patch, 3)} saving={saving} />}
              {step === 3 && (
                <Step3
                  assets={state.assets}
                  onAdd={async (a) => { await addAsset({ data: a }); await reload(); }}
                  onRemove={async (id) => { await rmAsset({ data: { id } }); await reload(); }}
                  onRefresh={async () => { await reload(); }}
                  onBack={goBack}
                  onNext={() => savePatch({}, 4)}
                  saving={saving}
                />
              )}
              {step === 4 && <Step4 onBack={goBack} onNext={(consents) => { void consents; savePatch({}, 5); }} saving={saving} />}
              {step === 5 && (
                <Step5
                  initial={profile?.authorization_level ?? "monitoring_enforcement"}
                  onBack={goBack}
                  onNext={(level) => savePatch({ authorization_level: level }, 6)}
                  saving={saving}
                />
              )}
              {step === 6 && (
                <Step6
                  profile={profile}
                  consentsPreset={CONSENT_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {} as Record<string, boolean>)}
                  onBack={goBack}
                  onSubmit={async ({ legal_name, signature_text }) => {
                    setSaving(true);
                    try {
                      await submit({
                        data: {
                          consents: CONSENT_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {} as Record<string, boolean>),
                          authorization_level: (profile?.authorization_level ?? "monitoring_enforcement") as any,
                          legal_name, signature_text,
                        },
                      });
                      await reload();
                      await qc.invalidateQueries();
                      setStep(7);
                      toast.success("Authorization signed and stored.");
                    } catch (e: any) {
                      toast.error(e?.message ?? "Signing failed");
                    } finally { setSaving(false); }
                  }}
                  saving={saving}
                />
              )}
              {step === 7 && (
                <Step7
                  state={state}
                  onBack={goBack}
                  onFinish={() => {
                    if (isEnterprise) setStep(8);
                    else navigate({ to: "/" });
                  }}
                  finishLabel={isEnterprise ? "Continue to enterprise documents" : "Enter dashboard"}
                />
              )}
              {step === 8 && isEnterprise && (
                <Step8
                  documents={state.documents}
                  userId={profile?.user_id ?? ""}
                  onUploaded={async ({ doc_type, filename, storage_path, mime, size_bytes }) => {
                    await recDoc({ data: { doc_type, filename, storage_path, mime, size_bytes } });
                    await reload();
                  }}
                  onRemove={async (id) => { await rmDoc({ data: { id } }); await reload(); }}
                  onBack={goBack}
                  onFinish={() => navigate({ to: "/" })}
                />
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}


/* ---------- Step 1 ---------- */
const CLIENT_TYPE_META: Record<string, { icon: any; description: string }> = {
  individual: { icon: User, description: "Protect your personal identity and reputation" },
  celebrity: { icon: Star, description: "Monitor media, impersonation and public narratives" },
  creator: { icon: Video, description: "Protect content, channels and sponsorship reputation" },
  business: { icon: Building2, description: "Protect company reputation and brand assets" },
  corporate: { icon: Building, description: "Advanced monitoring and enforcement" },
  agency: { icon: Users, description: "Manage protection for multiple clients" },
};

function Step1({ profile, onNext, saving }: { profile: State["profile"]; onNext: (v: string, acct: string) => void; saving: boolean }) {
  const [value, setValue] = useState<string>(profile?.client_type ?? "");
  const acct = useMemo(() => CLIENT_TYPES.find((c) => c.value === value)?.account ?? "personal", [value]);
  return (
    <div className="space-y-8">
      <p className="text-sm text-white/60 -mt-4">Select the option that best describes you or the entity you represent.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {CLIENT_TYPES.map((t) => {
          const meta = CLIENT_TYPE_META[t.value];
          const Icon = meta?.icon ?? User;
          const active = value === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setValue(t.value)}
              className={`group relative text-left rounded-2xl p-5 border transition-all duration-300 overflow-hidden ${
                active
                  ? "border-blue-400/60 bg-gradient-to-br from-blue-500/15 to-blue-500/5 shadow-[0_0_0_1px_rgba(59,130,246,0.4),0_10px_40px_-10px_rgba(59,130,246,0.6)]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
              }`}
            >
              {active && (
                <span className="absolute top-3 right-3 size-6 rounded-full bg-blue-500 grid place-items-center shadow-lg shadow-blue-500/50">
                  <Check className="size-3.5 text-white" />
                </span>
              )}
              <div className={`size-11 rounded-xl grid place-items-center mb-4 border transition-colors ${
                active ? "bg-blue-500/20 border-blue-400/40 text-blue-300" : "bg-white/5 border-white/10 text-white/70 group-hover:text-white"
              }`}>
                <Icon className="size-5" />
              </div>
              <div className="font-semibold text-[15px] text-white">{t.label}</div>
              <div className="text-xs text-white/55 mt-1 leading-relaxed pr-6">
                {meta?.description}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex justify-end pt-2">
        <Button
          disabled={!value || saving}
          onClick={() => onNext(value, acct)}
          className="h-11 px-6 bg-gradient-to-r from-[#2563EB] to-[#3B82F6] hover:opacity-90 shadow-lg shadow-blue-500/25 border-0"
        >
          Continue <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

/* ---------- Step 2 ---------- */
function Step2({ profile, isEnterprise, onBack, onNext, saving }: {
  profile: State["profile"]; isEnterprise: boolean;
  onBack: () => void; onNext: (patch: Record<string, unknown>) => void; saving: boolean;
}) {
  const [form, setForm] = useState({
    full_name: profile?.full_name ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    country: profile?.country ?? "",
    gov_id_ref: profile?.gov_id_ref ?? "",
    social: (profile?.social_profiles as any[])?.map((s) => String(s)).join("\n") ?? "",
    company_name: profile?.company_name ?? "",
    website: profile?.website ?? "",
    contact_person: profile?.contact_person ?? "",
    business_reg_number: profile?.business_reg_number ?? "",
    company_email: profile?.company_email ?? "",
    official_socials: (profile?.official_socials as any[])?.map((s) => String(s)).join("\n") ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const valid = isEnterprise
    ? form.company_name && form.website && form.country && form.contact_person && form.company_email
    : form.full_name && form.email && form.country;

  const submit = () => {
    const socials = form.social.split("\n").map((s) => s.trim()).filter(Boolean);
    const off = form.official_socials.split("\n").map((s) => s.trim()).filter(Boolean);
    const patch = isEnterprise
      ? {
          company_name: form.company_name, website: form.website, country: form.country,
          contact_person: form.contact_person, business_reg_number: form.business_reg_number,
          company_email: form.company_email, official_socials: off,
        }
      : {
          full_name: form.full_name, email: form.email, phone: form.phone, country: form.country,
          gov_id_ref: form.gov_id_ref || null, social_profiles: socials,
        };
    onNext(patch);
  };

  return (
    <Card>
      <CardHeader><CardTitle>{isEnterprise ? "Company information" : "Your information"}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isEnterprise ? (
          <>
            <Field label="Company Name" required><Input value={form.company_name} onChange={set("company_name")} /></Field>
            <Field label="Website" required><Input value={form.website} onChange={set("website")} placeholder="https://" /></Field>
            <Field label="Country" required><Input value={form.country} onChange={set("country")} /></Field>
            <Field label="Contact Person" required><Input value={form.contact_person} onChange={set("contact_person")} /></Field>
            <Field label="Business Registration Number"><Input value={form.business_reg_number} onChange={set("business_reg_number")} /></Field>
            <Field label="Company Email" required><Input type="email" value={form.company_email} onChange={set("company_email")} /></Field>
            <Field label="Official Social Profiles (one per line)"><textarea className="w-full rounded-md border border-border p-2 text-sm min-h-20" value={form.official_socials} onChange={set("official_socials")} /></Field>
          </>
        ) : (
          <>
            <Field label="Full Name" required><Input value={form.full_name} onChange={set("full_name")} /></Field>
            <Field label="Email" required><Input type="email" value={form.email} onChange={set("email")} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={set("phone")} /></Field>
            <Field label="Country" required><Input value={form.country} onChange={set("country")} /></Field>
            <Field label="Government ID reference (optional)"><Input value={form.gov_id_ref} onChange={set("gov_id_ref")} placeholder="e.g. passport number or filed ID" /></Field>
            <Field label="Social Profiles (one URL per line)"><textarea className="w-full rounded-md border border-border p-2 text-sm min-h-20" value={form.social} onChange={set("social")} /></Field>
          </>
        )}
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
          <Button disabled={!valid || saving} onClick={submit}>Continue <ChevronRight className="size-4 ml-1" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  );
}

/* ---------- Step 3 ---------- */
const ASSET_KINDS = [
  { value: "name", label: "Name" }, { value: "brand", label: "Brand" }, { value: "company", label: "Company" },
  { value: "product", label: "Product" }, { value: "social_account", label: "Social Account" },
  { value: "youtube_channel", label: "YouTube Channel" }, { value: "website", label: "Website" },
  { value: "logo", label: "Logo" }, { value: "image", label: "Image" }, { value: "video", label: "Video" },
  { value: "copyright", label: "Copyright Asset" },
] as const;

function Step3({ assets, onAdd, onRemove, onRefresh, onBack, onNext, saving }: {
  assets: State["assets"];
  onAdd: (a: { asset_kind: any; label: string; value?: string; url?: string; metadata?: Record<string, unknown> }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onBack: () => void; onNext: () => void; saving: boolean;
}) {
  const [kind, setKind] = useState<string>("brand");
  const [label, setLabel] = useState(""); const [value, setValue] = useState(""); const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const refreshYT = useServerFn(refreshOnboardingYouTubeAsset);

  const add = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try { await onAdd({ asset_kind: kind as any, label: label.trim(), value: value.trim() || undefined, url: url.trim() || undefined });
      setLabel(""); setValue(""); setUrl(""); }
    finally { setBusy(false); }
  };

  const confirmYouTube = async (ch: YTChannel) => {
    await onAdd({
      asset_kind: "youtube_channel",
      label: ch.channel_title,
      value: ch.channel_handle ?? ch.channel_id,
      url: ch.channel_url,
      metadata: {
        ...ch,
        confirmation_status: "user_confirmed",
        verification_status: "pending",
        last_synced_at: new Date().toISOString(),
        raw_provider_metadata: ch,
      },
    });
    toast.success(`Added ${ch.channel_title} · ownership verification pending`);
  };

  return (
    <Card>
      <CardHeader><CardTitle>Register your protected assets</CardTitle><CardDescription>Add every name, brand, account, or piece of content you want Eterna to monitor.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-4">
          <select className="border border-border rounded-md h-10 px-2 text-sm bg-background" value={kind} onChange={(e) => setKind(e.target.value)}>
            {ASSET_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          {kind !== "youtube_channel" && (
            <>
              <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
              <Input placeholder="Value / handle" value={value} onChange={(e) => setValue(e.target.value)} />
              <Input placeholder="URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
            </>
          )}
        </div>
        {kind === "youtube_channel" ? (
          <YouTubeChannelPicker onConfirm={confirmYouTube} />
        ) : (
          <div className="flex justify-end"><Button size="sm" disabled={!label.trim() || busy} onClick={add}>Add asset</Button></div>
        )}

        <div className="space-y-2">
          {assets.length === 0 && <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-xl">No assets yet — add at least one to continue.</div>}
          {assets.map((a) => (
            a.asset_kind === "youtube_channel" && (a.metadata as any)?.channel_id ? (
              <YouTubeAssetCard
                key={a.id}
                asset={a as any}
                onRefresh={async (id: string) => { await refreshYT({ data: { asset_id: id } }); await onRefresh(); }}
                onRemove={onRemove}
              />
            ) : (
              <div key={a.id} className="flex items-center gap-3 border border-border rounded-xl p-3">
                <Badge variant="secondary" className="uppercase text-[10px]">{a.asset_kind}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{a.label}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.value ?? a.url ?? ""}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onRemove(a.id)}><Trash2 className="size-4" /></Button>
              </div>
            )
          ))}
        </div>
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
          <Button disabled={assets.length === 0 || saving} onClick={onNext}>Continue <ChevronRight className="size-4 ml-1" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}


/* ---------- Step 4 ---------- */
function Step4({ onBack, onNext, saving }: { onBack: () => void; onNext: (consents: Record<string, boolean>) => void; saving: boolean }) {
  const [checks, setChecks] = useState<Record<string, boolean>>(() => CONSENT_KEYS.reduce((a, k) => ({ ...a, [k]: false }), {}));
  const allChecked = CONSENT_KEYS.every((k) => checks[k]);
  return (
    <Card>
      <CardHeader><CardTitle>Authorization & consent</CardTitle><CardDescription>Please read and confirm each statement. All are required.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {CONSENT_KEYS.map((k) => (
          <label key={k} className="flex gap-3 items-start border border-border rounded-xl p-3 cursor-pointer">
            <Checkbox checked={checks[k]} onCheckedChange={(v) => setChecks({ ...checks, [k]: !!v })} className="mt-0.5" />
            <span className="text-sm leading-relaxed">{CONSENT_TEXTS[k]}</span>
          </label>
        ))}
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
          <Button disabled={!allChecked || saving} onClick={() => onNext(checks)}>Continue <ChevronRight className="size-4 ml-1" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Step 5 ---------- */
function Step5({ initial, onBack, onNext, saving }: { initial: string; onBack: () => void; onNext: (level: string) => void; saving: boolean }) {
  const [level, setLevel] = useState<string>(initial);
  return (
    <Card>
      <CardHeader><CardTitle>Enforcement authorization</CardTitle><CardDescription>Choose how far Eterna should act on your behalf.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={level} onValueChange={setLevel} className="grid gap-2">
          {AUTHORIZATION_LEVELS.map((l) => (
            <label key={l.value} className={`border rounded-xl p-3 flex gap-3 cursor-pointer ${level === l.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"}`}>
              <RadioGroupItem value={l.value} id={l.value} className="mt-0.5" />
              <div><div className="font-semibold text-sm">{l.label}</div><div className="text-xs text-muted-foreground">{l.desc}</div></div>
            </label>
          ))}
        </RadioGroup>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
          <Button disabled={!level || saving} onClick={() => onNext(level)}>Continue <ChevronRight className="size-4 ml-1" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Step 6 ---------- */
function Step6({ profile, consentsPreset, onBack, onSubmit, saving }: {
  profile: State["profile"]; consentsPreset: Record<string, boolean>;
  onBack: () => void; onSubmit: (v: { legal_name: string; signature_text: string }) => Promise<void>; saving: boolean;
}) {
  void consentsPreset;
  const [legal, setLegal] = useState(profile?.full_name ?? profile?.contact_person ?? "");
  const [sig, setSig] = useState("");
  const today = new Date().toLocaleString();
  return (
    <Card>
      <CardHeader><CardTitle>Digital signature</CardTitle><CardDescription>Your electronic signature is legally binding. Date, IP address, and timestamp are captured automatically.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Field label="Full legal name" required><Input value={legal} onChange={(e) => setLegal(e.target.value)} /></Field>
        <Field label="Electronic signature (type your name)" required>
          <Input value={sig} onChange={(e) => setSig(e.target.value)} className="font-[cursive] text-lg" placeholder="Type your signature" />
        </Field>
        <div className="text-xs text-muted-foreground">Date & time: {today}</div>
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
          <Button disabled={!legal.trim() || !sig.trim() || saving} onClick={() => onSubmit({ legal_name: legal, signature_text: sig })}>
            Sign & store authorization
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Step 7 ---------- */
function Step7({ state, onBack, onFinish, finishLabel }: { state: State; onBack: () => void; onFinish: () => void; finishLabel: string }) {
  const a = state.authorization;
  return (
    <Card>
      <CardHeader><CardTitle>Authorization vault</CardTitle><CardDescription>Your signed authorization is stored and available for platform reports and legal review.</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {a ? (
          <div className="space-y-2 border border-border rounded-xl p-4 bg-emerald-50/40">
            <div className="flex items-center gap-2 text-emerald-800 font-semibold"><CheckCircle2 className="size-4" /> Authorization signed</div>
            <Row k="Legal name" v={a.legal_name} />
            <Row k="Authorization level" v={a.authorization_level} />
            <Row k="Signed at" v={new Date(a.signed_at).toLocaleString()} />
            <Row k="IP address" v={a.ip_address ?? "—"} />
            <Row k="Consent version" v={a.consent_version} />
            <Row k="Signature hash" v={<code className="text-[11px] break-all">{a.signature_hash}</code>} />
          </div>
        ) : <div className="text-muted-foreground">Authorization pending.</div>}
        <div className="text-xs text-muted-foreground">This record can be attached to YouTube copyright complaints, impersonation reports, trademark complaints, platform reports, and legal review.</div>
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
          <Button onClick={onFinish}>{finishLabel} <ChevronRight className="size-4 ml-1" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex gap-4 text-sm"><div className="w-40 text-muted-foreground">{k}</div><div className="flex-1 min-w-0">{v}</div></div>;
}

/* ---------- Step 8 ---------- */
const DOC_TYPES = [
  { value: "authorization_letter", label: "Authorization Letter" },
  { value: "agency_agreement", label: "Agency Agreement" },
  { value: "power_of_attorney", label: "Power of Attorney" },
  { value: "brand_protection", label: "Brand Protection Authorization" },
] as const;

function Step8({ documents, userId, onUploaded, onRemove, onBack, onFinish }: {
  documents: State["documents"]; userId: string;
  onUploaded: (d: { doc_type: any; filename: string; storage_path: string; mime?: string; size_bytes?: number }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onBack: () => void; onFinish: () => void;
}) {
  const [docType, setDocType] = useState<string>("authorization_letter");
  const [busy, setBusy] = useState(false);

  const handleUpload = async (file: File) => {
    if (!userId) return;
    setBusy(true);
    try {
      const path = `${userId}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("authorization-vault").upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      await onUploaded({ doc_type: docType as any, filename: file.name, storage_path: path, mime: file.type, size_bytes: file.size });
      toast.success("Document uploaded");
    } catch (e: any) { toast.error(e?.message ?? "Upload failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Enterprise documents</CardTitle><CardDescription>Upload authorization letters or agreements. Stored securely and only visible to your account.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <select className="border border-border rounded-md h-10 px-2 text-sm bg-background" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 px-4 h-10 border border-border rounded-md cursor-pointer bg-accent/40 text-sm font-medium">
            <Upload className="size-4" /> {busy ? "Uploading…" : "Upload file"}
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          </label>
        </div>
        <div className="space-y-2">
          {documents.length === 0 && <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-xl">No documents uploaded yet.</div>}
          {documents.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border border-border rounded-xl p-3">
              <Badge variant="secondary" className="uppercase text-[10px]">{d.doc_type.replaceAll("_", " ")}</Badge>
              <div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{d.filename}</div>
                <div className="text-xs text-muted-foreground">{new Date(d.uploaded_at).toLocaleString()}</div></div>
              <Button variant="ghost" size="icon" onClick={() => onRemove(d.id)}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}><ChevronLeft className="size-4 mr-1" /> Back</Button>
          <Button onClick={onFinish}>Enter dashboard <ChevronRight className="size-4 ml-1" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
