import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ShieldHalf,
  Lock,
  ShieldCheck,
  Building2,
  Radar,
  EyeOff,
  Fingerprint,
  Check,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { joinWaitlist, getWaitlistCount } from "@/lib/waitlist/waitlist.functions";
import desktopBg from "@/assets/waitlist-bg.jpg";
import mobileBg from "@/assets/waitlist-bg-mobile.jpg";

export const Route = createFileRoute("/waitinglist")({
  head: () => ({
    meta: [
      { title: "Join the Eterna Waitlist — Priority Access" },
      {
        name: "description",
        content:
          "Join the waitlist for priority access to Eterna's digital identity protection platform. Built for individuals, professionals and organizations.",
      },
      { property: "og:title", content: "Join the Eterna Waitlist — Priority Access" },
      {
        property: "og:description",
        content:
          "Be among the first to access Eterna Identity Protection. Priority access, early updates, digital protection.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WaitlistPage,
});

const PERSONAS = ["Student", "Individual", "Professional", "Organization"] as const;

type FormState = {
  fullName: string;
  phone: string;
  email: string;
  persona: (typeof PERSONAS)[number] | "";
  organization: string;
};

const GLASS =
  "rounded-2xl border border-white/12 bg-[rgba(5,12,35,0.35)] backdrop-blur-[18px] shadow-[0_18px_60px_-24px_rgba(0,0,0,0.75)]";

function WaitlistPage() {
  const navigate = useNavigate();
  const submit = useServerFn(joinWaitlist);
  const countFn = useServerFn(getWaitlistCount);

  const countQuery = useQuery({
    queryKey: ["waitlist-count"],
    queryFn: () => countFn(),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<FormState>({
    fullName: "",
    phone: "",
    email: "",
    persona: "",
    organization: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    waitlistId: string;
    alreadyJoined: boolean;
  } | null>(null);

  // Silent QR / campaign attribution — never asked for in the form.
  const [attribution, setAttribution] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setAttribution({
      source: p.get("source"),
      utmSource: p.get("utm_source"),
      utmMedium: p.get("utm_medium"),
      utmCampaign: p.get("utm_campaign"),
      referrer: p.get("referral") ?? document.referrer ?? null,
    });
  }, []);

  // Lock background scroll while the success modal is open.
  useEffect(() => {
    if (!result) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [result]);

  const canSubmit = useMemo(
    () =>
      form.fullName.trim().length >= 2 &&
      /^\S+@\S+\.\S+$/.test(form.email.trim()) &&
      form.phone.replace(/\D/g, "").length >= 7 &&
      form.persona !== "",
    [form],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || result) return;
    setError(null);
    if (!canSubmit) {
      setError("Please complete your name, mobile number, email and category.");
      return;
    }
    setLoading(true);
    try {
      const res = await submit({
        data: {
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          persona: form.persona as (typeof PERSONAS)[number],
          organization: form.organization.trim() || null,
          source: attribution["source"] ?? null,
          utmSource: attribution["utmSource"] ?? null,
          utmMedium: attribution["utmMedium"] ?? null,
          utmCampaign: attribution["utmCampaign"] ?? null,
          referrer: attribution["referrer"] ?? null,
        },
      });
      if (res.status === "ERROR") {
        setError(res.message);
        return;
      }
      setResult({ waitlistId: res.waitlistId, alreadyJoined: res.status === "ALREADY_JOINED" });
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const realCount = countQuery.data?.count ?? null;

  return (
    <main className="min-h-screen bg-[#04081c] p-2 sm:p-4">
      <div className="relative isolate flex min-h-[calc(100vh-16px)] flex-col overflow-hidden rounded-[24px] sm:rounded-[32px]">
        {/* Full-bleed abstract Eterna background */}
        <picture>
          <source media="(min-width: 768px)" srcSet={desktopBg} />
          <img
            src={mobileBg}
            alt=""
            aria-hidden="true"
            width={1920}
            height={1280}
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 -z-10 size-full object-cover object-[70%_30%] md:object-center"
          />
        </picture>
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(4,8,28,0.82)_0%,rgba(4,8,28,0.55)_38%,rgba(4,8,28,0.88)_100%)] md:bg-[linear-gradient(100deg,rgba(4,8,28,0.9)_0%,rgba(4,8,28,0.6)_45%,rgba(4,8,28,0.72)_100%)]"
        />

        {/* Top bar */}
        <header className="flex items-start justify-between gap-4 px-5 pt-6 sm:px-9 sm:pt-8">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl border border-white/15 bg-white/10 backdrop-blur-md">
              <ShieldHalf className="size-5 text-white" />
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-semibold tracking-[0.14em] text-white">
                ETERNA
              </span>
              <span className="block text-[10px] font-medium tracking-[0.24em] text-white/55">
                DIGITAL IDENTITY PROTECTION
              </span>
            </span>
          </div>
          <div className="hidden text-right sm:block">
            <span className="flex items-center justify-end gap-2 text-sm font-medium text-white/85">
              <Lock className="size-3.5" /> Secure. Private. Trusted.
            </span>
            <span className="mt-1 block text-xs text-white/50">
              Your information is protected.
            </span>
          </div>
        </header>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-8 px-5 pb-8 pt-8 sm:px-9 lg:grid lg:grid-cols-[1.05fr_minmax(420px,0.95fr)] lg:items-start lg:gap-12 lg:pt-14">
          {/* Hero */}
          <section className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[10px] font-semibold tracking-[0.22em] text-white/80 backdrop-blur-md">
              <Fingerprint className="size-3.5" /> ETERNA PRIORITY ACCESS
            </span>
            <h1 className="mt-5 text-[34px] font-medium leading-[1.08] tracking-[-0.02em] text-white sm:text-5xl lg:text-[66px]">
              Join the
              <span className="block font-semibold">Eterna Waitlist</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-white/80 sm:text-lg">
              Be among the first to access Eterna Identity Protection.
            </p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">
              Join the waitlist for priority access to Eterna's digital identity protection
              platform.
            </p>
          </section>

          {/* White card */}
          <section className="lg:sticky lg:top-6">
            <div className="rounded-[26px] border border-white/60 bg-[#fbfcfe] p-6 shadow-[0_40px_120px_-40px_rgba(2,6,23,0.85)] sm:p-8">
              <form onSubmit={handleSubmit} noValidate>
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-[#0b1533]">
                      <ShieldCheck className="size-5 text-white" />
                    </span>
                    <h2 className="text-xl font-semibold tracking-[-0.01em] text-[#0b1533] sm:text-[22px]">
                      Secure Your Priority Access
                    </h2>
                  </div>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Full Name"
                      value={form.fullName}
                      onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
                      autoComplete="name"
                      placeholder="Your full name"
                    />
                    <Field
                      label="Mobile Number"
                      value={form.phone}
                      onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+91 90000 00000"
                    />
                    <div className="sm:col-span-2">
                      <Field
                        label="Email Address"
                        value={form.email}
                        onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[13px] font-medium text-[#0b1533]/70">
                        I am a
                        <select
                          value={form.persona}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              persona: e.target.value as FormState["persona"],
                            }))
                          }
                          className="mt-1.5 h-[52px] w-full appearance-none rounded-xl border border-[#0b1533]/12 bg-white px-4 text-base text-[#0b1533] outline-none transition focus:border-[#0b1533]/40 focus:ring-4 focus:ring-[#0b1533]/5"
                        >
                          <option value="">Select one</option>
                          {PERSONAS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="sm:col-span-2">
                      <Field
                        label="College / Organization (optional)"
                        value={form.organization}
                        onChange={(v) => setForm((f) => ({ ...f, organization: v }))}
                        autoComplete="organization"
                        placeholder="Institution or company"
                      />
                    </div>
                  </div>

                  {error && (
                    <p className="mt-4 rounded-xl bg-[#b3261e]/8 px-4 py-3 text-sm text-[#b3261e]">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-[13px] bg-[#0b1533] text-base font-medium text-white transition hover:brightness-125 hover:shadow-[0_12px_30px_-12px_rgba(11,21,51,0.8)] disabled:opacity-70"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Joining Waitlist...
                      </>
                    ) : (
                      <>
                        Join the Waitlist <ArrowRight className="size-4" />
                      </>
                    )}
                  </button>

                  <p className="mt-4 flex items-center justify-center gap-2 text-xs text-[#0b1533]/55">
                    <ShieldCheck className="size-3.5" /> We respect your privacy. No spam, ever.
                  </p>
                </form>
            </div>
          </section>

          {/* Info cards */}
          <section className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-4">
            <InfoCard
              icon={Building2}
              title={"Institutional Grade\nProtection"}
              body="Built for individuals, professionals and organizations."
            />
            <InfoCard
              icon={Radar}
              title={"Advanced Threat\nDetection"}
              body="Detect digital identity risks across the web."
            />
            <InfoCard
              icon={EyeOff}
              title="Privacy First"
              body="Your identity and information are handled with strict confidentiality."
            />
            <InfoCard
              icon={ShieldHalf}
              title="Dedicated Protection"
              body="Protection designed for today's digital identity risks."
            />
          </section>
        </div>

        {/* Trust bar */}
        <footer className="px-5 pb-6 sm:px-9 sm:pb-8">
          <div
            className={`${GLASS} flex flex-col items-center gap-3 px-5 py-4 text-center sm:flex-row sm:justify-between sm:text-left`}
          >
            <p className="text-sm text-white/80">
              {realCount !== null
                ? `${realCount.toLocaleString()}+ people have joined the waitlist`
                : "Join the growing Eterna waitlist"}
            </p>
            <ShieldHalf className="size-4 text-white/60" />
            <p className="text-sm text-white/60">
              Priority access. Early updates. Digital protection.
            </p>
          </div>
        </footer>
      </div>

      {result && (
        <SuccessModal
          waitlistId={result.waitlistId}
          alreadyJoined={result.alreadyJoined}
          onClose={() => setResult(null)}
          onReturn={() => navigate({ to: "/" })}
        />
      )}
    </main>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: "text" | "tel" | "email";
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-[13px] font-medium text-[#0b1533]/70">
      {props.label}
      <input
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1.5 h-[52px] w-full rounded-xl border border-[#0b1533]/12 bg-white px-4 text-base text-[#0b1533] outline-none transition placeholder:text-[#0b1533]/30 focus:border-[#0b1533]/40 focus:ring-4 focus:ring-[#0b1533]/5"
      />
    </label>
  );
}

function InfoCard({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className={`${GLASS} p-5`}>
      <Icon className="size-5 text-white/70" />
      <h3 className="mt-4 whitespace-pre-line text-[15px] font-medium leading-snug text-white">
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-white/60">{body}</p>
    </div>
  );
}

function SuccessState({
  waitlistId,
  alreadyJoined,
  onReturn,
}: {
  waitlistId: string;
  alreadyJoined: boolean;
  onReturn: () => void;
}) {
  return (
    <div className="animate-in fade-in zoom-in-95 py-2 text-center duration-500">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#0b1533]">
        <Check className="size-7 text-white" />
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-[0.04em] text-[#0b1533]">
        {alreadyJoined ? "YOU'RE ALREADY ON THE LIST ✓" : "YOU'RE ON THE LIST"}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-[#0b1533]/65">
        {alreadyJoined ? (
          "Your Eterna priority access is already registered."
        ) : (
          <>
            Welcome to the Eterna Waitlist.
            <br />
            Your priority access has been registered.
          </>
        )}
      </p>
      <div className="mt-6 rounded-2xl border border-[#0b1533]/10 bg-[#0b1533]/4 px-5 py-4">
        <p className="text-[10px] font-semibold tracking-[0.22em] text-[#0b1533]/50">WAITLIST ID</p>
        <p className="mt-1 text-lg font-semibold tracking-[0.08em] text-[#0b1533]">{waitlistId}</p>
      </div>
      {!alreadyJoined && (
        <p className="mt-4 text-xs text-[#0b1533]/55">
          We'll notify you when your Eterna access is ready.
        </p>
      )}
      <button
        type="button"
        onClick={onReturn}
        className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-[13px] bg-[#0b1533] text-base font-medium text-white transition hover:brightness-125"
      >
        Return to Eterna <ArrowRight className="size-4" />
      </button>
    </div>
  );
}
