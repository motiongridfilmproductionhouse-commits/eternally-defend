import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import {
  getMyPartnerApplication,
  submitPartnerApplication,
} from "@/lib/partners/applications.functions";
import { getPartnerUploadUrl } from "@/lib/partners/dashboard.functions";
import { ShieldCheck, Building2, FileSignature } from "lucide-react";

export const Route = createFileRoute("/partner-apply")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Become an Eterna Partner" },
      { name: "description", content: "Apply to join the Eterna Partner Programme and refer clients for a 25% commission." },
    ],
  }),
  component: PartnerApplyPage,
});

type Form = {
  legal_company_name: string; trading_name: string; registration_number: string;
  country: string; address: string; website: string; industry: string;
  founder_name: string; rep_name: string; rep_title: string;
  business_email: string; phone: string; whatsapp: string;
  territory: string; expected_monthly_clients: string;
  partnership_type: "referral" | "reseller" | "agency" | "enterprise";
  signature_text: string;
};

const empty: Form = {
  legal_company_name: "", trading_name: "", registration_number: "",
  country: "", address: "", website: "", industry: "",
  founder_name: "", rep_name: "", rep_title: "",
  business_email: "", phone: "", whatsapp: "",
  territory: "", expected_monthly_clients: "",
  partnership_type: "referral", signature_text: "",
};

function PartnerApplyPage() {
  const navigate = useNavigate();
  const submit = useServerFn(submitPartnerApplication);
  const getUpload = useServerFn(getPartnerUploadUrl);
  const loadExisting = useServerFn(getMyPartnerApplication);

  const [checking, setChecking] = useState(true);
  const [form, setForm] = useState<Form>(empty);
  const [decl, setDecl] = useState({
    authority: false, accurate: false, commercial_terms: false, no_incentives: false, data_protection: false,
  });
  const [tradeLicKey, setTradeLicKey] = useState<string | null>(null);
  const [idDocKey, setIdDocKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState<null | "trade_licence" | "id_document">(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        // The application page is public. Authentication is required only
        // when the visitor uploads documents or submits the application.
        setChecking(false);
        return;
      }

      const existing = await loadExisting({});
      if (existing.application) {
        navigate({ to: "/partner-status" });
        return;
      }

      setForm((f) => ({
        ...f,
        business_email: session.session.user.email ?? "",
      }));
      setChecking(false);
    })();
  }, [loadExisting, navigate]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const upload = async (kind: "trade_licence" | "id_document", file: File) => {
    setUploading(kind);
    try {
      const { url, token, path } = await getUpload({ data: { filename: file.name, kind } });
      const res = await fetch(url, { method: "PUT", headers: { "x-upsert": "true", authorization: `Bearer ${token}` }, body: file });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      if (kind === "trade_licence") setTradeLicKey(path);
      else setIdDocKey(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const canSubmit =
    form.legal_company_name && form.country && form.founder_name && form.rep_name &&
    form.business_email && form.signature_text &&
    decl.authority && decl.accurate && decl.commercial_terms && decl.no_incentives && decl.data_protection;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true); setError(null);
    try {
      // Public application UX with a secure anonymous Supabase identity.
      // The visitor does not see a login screen, while authenticated
      // server middleware and per-user database ownership remain intact.
      const { data: currentAuth, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!currentAuth.session) {
        const { error: anonymousError } =
          await supabase.auth.signInAnonymously();

        if (anonymousError) {
          throw new Error(
            `Unable to start application session: ${anonymousError.message}`
          );
        }
      }

      await submit({
        data: {
          legal_company_name: form.legal_company_name.trim(),
          trading_name: form.trading_name.trim() || null,
          registration_number: form.registration_number.trim() || null,
          country: form.country.trim(),
          address: form.address.trim() || null,
          website: form.website.trim() || null,
          industry: form.industry.trim() || null,
          founder_name: form.founder_name.trim(),
          rep_name: form.rep_name.trim(),
          rep_title: form.rep_title.trim() || null,
          business_email: form.business_email.trim(),
          phone: form.phone.trim() || null,
          whatsapp: form.whatsapp.trim() || null,
          territory: form.territory.trim() || null,
          expected_monthly_clients: form.expected_monthly_clients ? Number(form.expected_monthly_clients) : null,
          partnership_type: form.partnership_type,
          trade_licence_s3_key: tradeLicKey,
          id_document_s3_key: idDocKey,
          declarations: {
            authority: true, accurate: true, commercial_terms: true,
            no_incentives: true, data_protection: true,
          },
          signature_text: form.signature_text.trim(),
        },
      });
      navigate({ to: "/partner-status" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/auth" className="flex items-center gap-2">
            <div className="size-8 rounded-lg grid place-items-center text-white" style={{ background: "linear-gradient(135deg,#1037A6,#1E5EFF)" }}>
              <ShieldCheck className="size-4" />
            </div>
            <div className="font-semibold">Eterna Partner Programme</div>
          </Link>
          <Link to="/auth" className="text-sm text-slate-500 hover:text-slate-800">Back to sign in</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Become an Eterna Partner</h1>
          <p className="mt-2 text-slate-500 max-w-2xl">
            Refer clients to Eterna Sentinel Defence LLC and earn 25% commission (₹1,25,000) per qualifying paid client of the ₹5,00,000 Eterna Protection Programme.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <Section icon={Building2} title="Company Information">
            <Grid>
              <Field label="Legal company name *"><Input value={form.legal_company_name} onChange={(e) => set("legal_company_name", e.target.value)} required /></Field>
              <Field label="Trading name"><Input value={form.trading_name} onChange={(e) => set("trading_name", e.target.value)} /></Field>
              <Field label="Registration number"><Input value={form.registration_number} onChange={(e) => set("registration_number", e.target.value)} /></Field>
              <Field label="Country *"><Input value={form.country} onChange={(e) => set("country", e.target.value)} required /></Field>
              <Field label="Website"><Input placeholder="https://" value={form.website} onChange={(e) => set("website", e.target.value)} /></Field>
              <Field label="Industry"><Input value={form.industry} onChange={(e) => set("industry", e.target.value)} /></Field>
              <Field label="Company address" full><Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
            </Grid>
          </Section>

          <Section icon={Building2} title="People & Contact">
            <Grid>
              <Field label="Founder's full name *"><Input value={form.founder_name} onChange={(e) => set("founder_name", e.target.value)} required /></Field>
              <Field label="Authorised representative *"><Input value={form.rep_name} onChange={(e) => set("rep_name", e.target.value)} required /></Field>
              <Field label="Representative job title"><Input value={form.rep_title} onChange={(e) => set("rep_title", e.target.value)} /></Field>
              <Field label="Business email *"><Input type="email" value={form.business_email} onChange={(e) => set("business_email", e.target.value)} required /></Field>
              <Field label="Business phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Field label="WhatsApp"><Input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
            </Grid>
          </Section>

          <Section icon={Building2} title="Partnership">
            <Grid>
              <Field label="Territory">
                <Input placeholder="e.g. India, UAE, Southeast Asia" value={form.territory} onChange={(e) => set("territory", e.target.value)} />
              </Field>
              <Field label="Expected clients / month">
                <Input type="number" min={0} value={form.expected_monthly_clients} onChange={(e) => set("expected_monthly_clients", e.target.value)} />
              </Field>
              <Field label="Partnership type *">
                <select
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.partnership_type}
                  onChange={(e) => set("partnership_type", e.target.value as Form["partnership_type"])}
                >
                  <option value="referral">Referral Partner</option>
                  <option value="reseller">Reseller</option>
                  <option value="agency">Agency</option>
                  <option value="enterprise">Enterprise / Channel</option>
                </select>
              </Field>
            </Grid>
          </Section>

          <Section icon={ShieldCheck} title="Verification Documents">
            <div className="grid md:grid-cols-2 gap-4">
              <UploadTile
                label="Trade licence (Optional)"
                busy={uploading === "trade_licence"}
                uploadedName={tradeLicKey?.split("/").pop() ?? null}
                onFile={(f) => upload("trade_licence", f)}
              />
              <UploadTile
                label="Representative ID document (Optional)"
                busy={uploading === "id_document"}
                uploadedName={idDocKey?.split("/").pop() ?? null}
                onFile={(f) => upload("id_document", f)}
              />
            </div>
          </Section>

          <Section icon={FileSignature} title="Declarations & Electronic Signature">
            <div className="space-y-3 text-sm">
              <Decl label="I have the authority to sign on behalf of the company named above." checked={decl.authority} onChange={(v) => setDecl((d) => ({ ...d, authority: v }))} />
              <Decl label="All information and documents I have provided are true and accurate." checked={decl.accurate} onChange={(v) => setDecl((d) => ({ ...d, accurate: v }))} />
              <Decl label="I agree to the commercial terms: Eterna price ₹5,00,000 per client, partner commission 25% (₹1,25,000), Eterna gross ₹3,75,000. Commission is payable only after Eterna receives cleared payment; taxes, discounts, refunds, cancellations and chargebacks are excluded." checked={decl.commercial_terms} onChange={(v) => setDecl((d) => ({ ...d, commercial_terms: v }))} />
              <Decl label="I will not offer cashbacks, kickbacks or incentives to prospects to induce sign-ups." checked={decl.no_incentives} onChange={(v) => setDecl((d) => ({ ...d, no_incentives: v }))} />
              <Decl label="I will process personal data in line with applicable data-protection law and keep Eterna and client information confidential." checked={decl.data_protection} onChange={(v) => setDecl((d) => ({ ...d, data_protection: v }))} />
            </div>
            <div className="mt-6 max-w-md">
              <Label className="text-xs uppercase tracking-wider text-slate-500">Type your full legal name to sign *</Label>
              <Input className="mt-1" value={form.signature_text} onChange={(e) => set("signature_text", e.target.value)} placeholder="Full legal name" required />
              <p className="mt-2 text-xs text-slate-500">
                By submitting, you sign the Eterna Partner Application electronically. A draft Partner Agreement / MOU will be generated automatically and marked <strong>Draft — Awaiting Eterna Approval</strong>.
              </p>
            </div>
          </Section>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex items-center justify-between border-t border-slate-200 pt-6">
            <div className="text-xs text-slate-500">Your application will be marked <strong>Pending Review</strong>.</div>
            <Button type="submit" disabled={!canSubmit || submitting} className="h-11 px-6 text-white" style={{ background: "linear-gradient(90deg,#1037A6,#1E5EFF)" }}>
              {submitting ? "Submitting…" : "Submit application"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <Card className="border border-slate-200 shadow-sm rounded-xl p-6 bg-white">
      <div className="flex items-center gap-2 mb-5">
        <Icon className="size-4 text-blue-600" />
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid md:grid-cols-2 gap-4">{children}</div>;
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <Label className="text-xs uppercase tracking-wider text-slate-500">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Decl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} className="mt-0.5" />
      <span className="text-slate-700">{label}</span>
    </label>
  );
}

function UploadTile({ label, required, busy, uploadedName, onFile }: {
  label: string; required?: boolean; busy: boolean; uploadedName: string | null;
  onFile: (f: File) => void;
}) {
  return (
    <label className="block cursor-pointer border border-dashed border-slate-300 rounded-lg p-4 hover:border-blue-500 transition">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}{required ? " *" : ""}</div>
      <div className="mt-2 text-sm">
        {busy ? "Uploading…" : uploadedName ? <span className="text-green-600">✓ {uploadedName}</span> : <span className="text-slate-500">Click to select file (PDF / JPG / PNG)</span>}
      </div>
      <input
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
  );
}
