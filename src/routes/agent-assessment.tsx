import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ShieldHalf, ArrowRight, Plus, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  agentAccess,
  createAssessment,
  getAssessment,
  listAssessments,
  assessmentDecision,
} from "@/lib/agent/assessment.functions";
import { isTerminal, formatPrice } from "@/lib/agent/model";
import { elitePackage, exposureLevel } from "@/lib/agent/policy";
import { AssessmentSearchAnimation } from "@/components/agent/AssessmentSearchAnimation";

export const Route = createFileRoute("/agent-assessment")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Private Assessment — Eterna Agent" }, { name: "robots", content: "noindex" }],
  }),
  component: AgentAssessment,
});
const surface =
  "rounded-[28px] border border-slate-200/80 bg-white/90 p-6 sm:p-10 shadow-[0_12px_50px_-24px_rgba(30,64,175,0.16)]";
function AgentAssessment() {
  const accessFn = useServerFn(agentAccess);
  const create = useServerFn(createAssessment);
  const get = useServerFn(getAssessment);
  const list = useServerFn(listAssessments);
  const decide = useServerFn(assessmentDecision);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [handoff, setHandoff] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const access = useQuery({ queryKey: ["agent-access"], queryFn: () => accessFn(), retry: false });
  const recent = useQuery({
    queryKey: ["agent-assessments"],
    queryFn: () => list(),
    enabled: !!access.data,
  });
  const current = useQuery({
    queryKey: ["agent-assessment", id],
    queryFn: () => get({ data: { id: id! } }),
    enabled: !!id && !!access.data,
    retry: false,
    refetchInterval: (query) =>
      query.state.error || (query.state.data && isTerminal(query.state.data.status)) ? false : 3000,
  });
  const a = current.data;
  const status = a?.status;
  const refreshRecent = recent.refetch;
  useEffect(() => {
    if (status && isTerminal(status)) void refreshRecent();
  }, [status, refreshRecent]);
  const reset = () => {
    setId(null);
    setHandoff(null);
    setQr(null);
    setNotice("");
  };
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const created = await create({ data: { artist_name: name, official_profile_url: profile } });
      setId(created.id);
      await recent.refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to start assessment.");
    } finally {
      setBusy(false);
    }
  }
  async function decision(value: "INTERESTED" | "DECLINED" | "SAVED") {
    if (!id) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await decide({ data: { id, decision: value } });
      if (result.redirect_url) {
        setHandoff(result.redirect_url);
        const QR = await import("qrcode");
        setQr(
          await QR.toDataURL(window.location.origin + result.redirect_url, {
            width: 180,
            margin: 1,
          }),
        );
      } else setNotice(value === "SAVED" ? "Assessment saved." : "Client decision saved.");
      await current.refetch();
      await recent.refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save assessment.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-900 selection:bg-blue-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-7 sm:px-10">
        <a
          href="/agent-assessment"
          className="flex items-center gap-3 text-sm font-semibold tracking-[0.16em]"
        >
          <ShieldHalf className="size-7 text-blue-600" /> ETERNA AGENT
        </a>
        <div className="flex items-center gap-4 text-sm">
          {access.data?.admin && (
            <a href="/agent-admin" className="text-blue-700">
              Agent settings
            </a>
          )}
          <a href="/auth">Client login</a>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-5 pb-20 pt-8 sm:px-10 sm:pt-14">
        <div className="mb-10">
          <p className="mb-4 text-xs uppercase tracking-[0.22em] text-blue-600">
            Private digital protection
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">
            Celebrity Protection Assessment
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-500">
            Assess a public profile before beginning Eterna protection.
          </p>
        </div>
        {access.isLoading ? (
          <p role="status">Verifying secure access…</p>
        ) : access.error ? (
          <section className={surface}>
            <h2 className="text-xl font-semibold">Authorized agents only</h2>
            <p className="my-5 text-slate-500">
              Sign in with your Eterna agent account. An administrator must enable agent access.
            </p>
            <Button asChild>
              <a href="/auth?agent=1">
                Agent sign in <ArrowRight />
              </a>
            </Button>
          </section>
        ) : (
          <>
            {!id && (
              <form onSubmit={start} className={surface + " space-y-6"}>
                <div>
                  <label htmlFor="artist" className="mb-2 block text-sm font-medium">
                    Artist / Celebrity Name
                  </label>
                  <Input
                    id="artist"
                    required
                    minLength={2}
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter artist name"
                    className="h-14 rounded-2xl bg-slate-50/50 text-base"
                  />
                </div>
                <div>
                  <label htmlFor="profile" className="mb-2 block text-sm font-medium">
                    Official Profile URL{" "}
                    <span className="font-normal text-slate-400">· optional</span>
                  </label>
                  <Input
                    id="profile"
                    type="url"
                    maxLength={2048}
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                    placeholder="https://…"
                    className="h-14 rounded-2xl bg-slate-50/50 text-base"
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    An official profile helps distinguish people with similar names.
                  </p>
                </div>
                <Button
                  disabled={busy}
                  className="h-14 w-full rounded-2xl bg-blue-600 text-sm tracking-wide hover:bg-blue-700"
                >
                  {busy ? "Creating assessment…" : "START ASSESSMENT"}
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              </form>
            )}
            {id && (
              <>
                <button
                  onClick={reset}
                  className="mb-5 flex min-h-11 items-center gap-2 text-sm text-slate-500"
                >
                  <ArrowLeft className="size-4" /> New assessment
                </button>
                {current.error ? (
                  <section className={surface}>
                    <p role="alert">
                      Could not load this assessment. Check your connection and access.
                    </p>
                    <Button onClick={() => current.refetch()} className="mt-4">
                      Try again
                    </Button>
                  </section>
                ) : !a ? (
                  <p role="status">Loading assessment…</p>
                ) : !isTerminal(a.status) ? (
                  <AssessmentSearchAnimation
                    artistName={a.artist_name}
                    imageUrl={a.image_url}
                    stage={a.stage}
                  />
                ) : (
                  <section className={surface}>
                    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
                      <div className="min-w-0">
                        <p className="text-xs tracking-[0.18em] text-blue-600">
                          DIGITAL PROTECTION ASSESSMENT
                        </p>
                        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                          {a.artist_name}
                        </h2>
                        {a.signals && (
                          <>
                            <div className="mt-7 flex items-center gap-3">
                              <span
                                className={
                                  "rounded-full px-3 py-1 text-xs font-semibold tracking-[0.12em] " +
                                  (exposureLevel(a.signals) === "HIGH"
                                    ? "bg-red-50 text-red-700"
                                    : exposureLevel(a.signals) === "ELEVATED"
                                      ? "bg-amber-50 text-amber-700"
                                      : exposureLevel(a.signals) === "MODERATE"
                                        ? "bg-blue-50 text-blue-700"
                                        : "bg-slate-100 text-slate-600")
                                }
                              >
                                {exposureLevel(a.signals)} EXPOSURE
                              </span>
                              <span className="text-xs text-slate-400">
                                Observed volume, not verified misuse
                              </span>
                            </div>
                            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                              <div className="rounded-2xl bg-slate-50 p-5">
                                <p className="text-xs text-slate-500">Name-matched pages</p>
                                <p className="mt-2 text-3xl font-semibold tracking-tight">
                                  {a.signals.matched_pages}
                                </p>
                              </div>
                              <div className="rounded-2xl bg-slate-50 p-5">
                                <p className="text-xs text-slate-500">Observed domains</p>
                                <p className="mt-2 text-3xl font-semibold tracking-tight">
                                  {a.signals.domains}
                                </p>
                              </div>
                              <div className="rounded-2xl bg-slate-50 p-5">
                                <p className="text-xs text-slate-500">Official profile</p>
                                <p className="mt-2 text-xl font-semibold">
                                  {a.signals.official_profile_found ? "Resolved" : "Not resolved"}
                                </p>
                              </div>
                            </div>
                            <p className="mt-4 text-xs leading-5 text-slate-400">
                              {a.signals.scope} Identity misuse and AI misuse assessments are
                              unavailable in this quick scan.
                            </p>
                          </>
                        )}
                        {a.status === "READY" && a.pricing ? (
                          <>
                            <p className="mt-9 text-xs tracking-[0.12em] text-slate-500">
                              ESTIMATED ETERNA PROTECTION
                            </p>
                            <p className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                              {formatPrice(a.pricing)}
                            </p>
                            <p className="mt-4 text-sm leading-6 text-slate-500">
                              Estimated from the observed public-web sample and anticipated
                              monitoring and review workload. This is an estimate, subject to Eterna
                              review.
                            </p>
                          </>
                        ) : (
                          <>
                            <h3 className="mt-8 text-xl font-medium">
                              {a.status === "FAILED"
                                ? "Scan temporarily unavailable."
                                : "Assessment requires Eterna review."}
                            </h3>
                            <p className="mt-3 text-sm leading-6 text-slate-500">{a.reason}</p>
                          </>
                        )}
                        {(a.status === "READY" || a.status === "REVIEW_REQUIRED") &&
                          (() => {
                            const elite = elitePackage();
                            return (
                              <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50/60 p-6">
                                <p className="text-xs tracking-[0.14em] text-blue-700">
                                  RECOMMENDED — ETERNA ELITE
                                </p>
                                <p className="mt-3 text-2xl font-semibold tracking-tight">
                                  {elite.usd_label} / year
                                </p>
                                <p className="mt-1 text-sm text-slate-600">
                                  ≈ {elite.inr_label} / year (indicative at ₹{elite.rate} per US$1)
                                </p>
                                <p className="mt-4 text-sm leading-6 text-slate-500">
                                  Full-scope protection for high-exposure public figures: continuous
                                  monitoring across the public web and social platforms,
                                  impersonation and deepfake detection, evidence preservation, and
                                  managed removal handling by the Eterna team. Fixed package price —
                                  final rate and scope are confirmed at contracting.
                                </p>
                              </div>
                            );
                          })()}
                      </div>
                      <div className="lg:sticky lg:top-6">
                        {a.image_url ? (
                          <img
                            src={a.image_url}
                            alt={a.artist_name}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="aspect-[4/5] w-full rounded-3xl object-cover shadow-sm"
                          />
                        ) : (
                          <div className="grid aspect-[4/5] w-full place-items-center rounded-3xl bg-gradient-to-br from-blue-100 via-slate-100 to-violet-100 text-6xl font-semibold text-slate-400">
                            {a.artist_name.trim().charAt(0).toUpperCase()}
                          </div>
                        )}
                        <p className="mt-3 text-center text-xs text-slate-400">
                          Public reference image
                        </p>
                      </div>
                    </div>

                    {a.status === "READY" ? (
                      <div className="mt-9 space-y-3 border-t border-slate-100 pt-7">
                        <p className="mb-4 text-sm">
                          Would the client like to proceed with Eterna?
                        </p>
                        <Button
                          disabled={busy}
                          onClick={() => decision("INTERESTED")}
                          className="min-h-14 w-full whitespace-normal rounded-2xl bg-blue-600"
                        >
                          CLIENT INTERESTED — CONTINUE <ArrowRight className="ml-2 size-4" />
                        </Button>
                        <Button
                          disabled={busy}
                          variant="outline"
                          className="h-12 w-full rounded-2xl"
                          onClick={() => decision("SAVED")}
                        >
                          SAVE ASSESSMENT
                        </Button>
                        <button
                          disabled={busy}
                          onClick={() => decision("DECLINED")}
                          className="min-h-11 w-full text-sm text-slate-500"
                        >
                          Not interested
                        </button>
                      </div>
                    ) : a.status === "REVIEW_REQUIRED" ? (
                      <div className="mt-8 flex flex-wrap gap-3">
                        <Button disabled={busy} onClick={() => decision("SAVED")}>
                          Save for review
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setName(a.artist_name);
                            setProfile(a.official_profile_url ?? "");
                            reset();
                          }}
                        >
                          Add official profile
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="mt-7"
                        onClick={() => {
                          setName(a.artist_name);
                          setProfile(a.official_profile_url ?? "");
                          reset();
                        }}
                      >
                        Try again
                      </Button>
                    )}
                  </section>
                )}
              </>
            )}
            {handoff && (
              <section className={surface + " mt-6"}>
                <h3 className="text-xl font-medium">Continue with the client</h3>
                <p className="my-4 text-sm leading-6 text-slate-500">
                  Open the existing Eterna login on the client’s device. The secure reference
                  expires in 24 hours. New accounts still require an Eterna invitation.
                </p>
                {qr && (
                  <img
                    src={qr}
                    width="180"
                    height="180"
                    alt="QR code for secure Eterna client handoff"
                    className="mb-5"
                  />
                )}
                <Button asChild>
                  <a href={handoff} referrerPolicy="no-referrer">
                    Continue to client login <ArrowRight />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard.writeText(window.location.origin + handoff);
                    setNotice("Secure link copied.");
                  }}
                >
                  Copy secure link
                </Button>
              </section>
            )}
            {notice && (
              <p
                role="status"
                className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"
              >
                {notice}
              </p>
            )}
            <section className="mt-12">
              <button
                onClick={reset}
                className="flex min-h-11 items-center gap-2 text-sm text-blue-600"
              >
                <Plus className="size-4" /> New assessment
              </button>
            </section>
          </>
        )}
        <footer className="mt-14 text-xs text-slate-400">
          Private AI-powered digital protection assessment.
        </footer>
      </div>
    </main>
  );
}
