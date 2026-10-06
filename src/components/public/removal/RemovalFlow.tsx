import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, CreditCard, FileUp, Loader2, ScanSearch, ShieldCheck, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { analyzeRemovalLink, requestRemovalInvoice, submitRemovalOrder } from "@/lib/removal-orders.functions";

const STAGES = ["Connecting to URL", "Identifying platform", "Detecting content type",
  "Extracting available page information", "Checking potential policy categories", "Preparing case assessment"];
const AFFECTS = ["Me personally", "My client", "My company / brand", "Someone I legally represent", "Copyright or trademark owner"];
const ISSUES = ["False or misleading information", "Defamation", "Privacy violation", "Impersonation",
  "Unauthorized photo or video", "Deepfake / AI-generated content", "Copyright infringement", "Trademark misuse",
  "Harmful or abusive review", "Personal information exposure", "Other"];
const ACCEPT = ".jpg,.jpeg,.png,.pdf,.doc,.docx";

type Analysis = Awaited<ReturnType<typeof analyzeRemovalLink>>;
type Result = Awaited<ReturnType<typeof submitRemovalOrder>>;
type Step = "analyzing" | "analyzed" | "affects" | "issue" | "contact" | "assessing" | "result" | "checkout" | "done" | "error";

function toB64(f: File) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

function Stages({ busy }: { busy: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setI((n) => Math.min(n + 1, STAGES.length - 1)), 900);
    return () => clearInterval(id);
  }, [busy]);
  return (
    <div className="space-y-5">
      <div className="relative mx-auto grid size-24 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/15 motion-reduce:animate-none" />
        <span className="absolute inset-2 animate-spin rounded-full border-2 border-primary/20 border-t-primary motion-reduce:animate-none" />
        <ScanSearch className="size-8 text-primary" />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-[removal-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none" />
      </div>
      <ul className="space-y-2 text-sm">
        {STAGES.map((s, n) => (
          <li key={s} className={`flex items-center gap-2 transition-opacity ${n <= i ? "opacity-100" : "opacity-35"}`}>
            {n < i ? <Check className="size-4 text-primary" /> : n === i ? <Loader2 className="size-4 animate-spin text-primary" /> : <span className="size-4 rounded-full border" />}
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="max-w-[60%] break-all text-right font-medium">{v || "Not available"}</span>
    </div>
  );
}

function Choice({ items, value, onPick }: { items: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((o) => (
        <button key={o} type="button" onClick={() => onPick(o)}
          className={`rounded-lg border px-3 py-2.5 text-left text-sm transition hover:border-primary ${value === o ? "border-primary bg-primary/5 font-medium" : ""}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function RemovalFlow({ initialUrl, variant = "light" }: { initialUrl?: string; variant?: "light" | "dark" } = {}) {
  const analyze = useServerFn(analyzeRemovalLink);
  const submit = useServerFn(submitRemovalOrder);
  const invoice = useServerFn(requestRemovalInvoice);
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("analyzing");
  const [err, setErr] = useState("");
  const [a, setA] = useState<Analysis | null>(null);
  const [r, setR] = useState<Result | null>(null);
  const [affects, setAffects] = useState("");
  const [issue, setIssue] = useState("");
  const [explanation, setExplanation] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [c, setC] = useState({ fullName: "", email: "", phone: "", country: "" });
  const [confirmed, setConfirmed] = useState(false);
  const [method, setMethod] = useState<"card" | "apple_pay" | "google_pay">("card");
  const busy = step === "analyzing" || step === "assessing";

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!initialUrl || autoStarted.current) return;
    autoStarted.current = true;
    setUrl(initialUrl);
    void run(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    await run(url);
  }

  async function run(raw: string) {
    let u = raw.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try { new URL(u); } catch { setErr("Enter a valid link."); return; }
    setErr(""); setOpen(true); setStep("analyzing");
    try {
      const [res] = await Promise.all([analyze({ data: { url: u } }), new Promise((s) => setTimeout(s, 4800))]);
      setA(res); setStep("analyzed");
    } catch { setErr("We could not analyze that link."); setStep("error"); }
  }

  async function assess() {
    if (!a) return;
    setStep("assessing");
    try {
      const enc = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, base64: await toB64(f) })));
      const [res] = await Promise.all([
        submit({ data: { ...a, affects, issue, explanation, ...c, confirmed: true, files: enc as never } }),
        new Promise((s) => setTimeout(s, 3000)),
      ]);
      setR(res); setStep("result");
    } catch (e) { setErr(e instanceof Error ? e.message : "Submission failed."); setStep("error"); }
  }

  async function pay() {
    if (!r) return;
    try { await invoice({ data: { caseId: r.caseId, email: c.email, method } }); setStep("done"); }
    catch { setErr("Could not complete checkout."); setStep("error"); }
  }

  const contactOk = c.fullName.length > 1 && /\S+@\S+\.\S+/.test(c.email) && c.phone.length > 4 && c.country.length > 1 && confirmed;
  const fee = r ? `${r.fee.currency} ${r.fee.amount.toLocaleString()}` : "USD 1,000";

  const notes = (
    <div className={`mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] ${variant === "dark" ? "text-zinc-500" : "text-muted-foreground"}`}>
      {["Pay per link", "No subscription required", "Track every request"].map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className={`size-1 rounded-full ${variant === "dark" ? "bg-zinc-300" : "bg-muted-foreground/40"}`} />
          {t}
        </span>
      ))}
    </div>
  );

  return (
    <>
      {variant === "dark" ? (
        <form onSubmit={start} className="group w-full max-w-3xl">
          <div className="relative flex items-center rounded-full border border-zinc-200 bg-white/70 p-1 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.15)] backdrop-blur-xl transition-all duration-500 focus-within:border-zinc-300 focus-within:ring-4 focus-within:ring-zinc-950/5">
            <div className="absolute inset-y-0 left-8 w-px bg-gradient-to-b from-transparent via-blue-500/50 to-transparent opacity-0 transition-opacity group-focus-within:opacity-100" aria-hidden="true" />
            <label htmlFor="removal-url" className="sr-only">Paste URL for Removal</label>
            <input
              id="removal-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste URL for Removal"
              className="flex-1 min-w-0 bg-transparent px-5 py-3 text-base text-zinc-900 outline-none placeholder:text-zinc-400 sm:px-8 sm:py-5 sm:text-xl"
            />
            <button
              type="submit"
              className="flex shrink-0 items-center gap-2 rounded-full bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-zinc-800 active:scale-95 sm:px-8 sm:py-4 sm:text-base"
            >
              Analyze Link
              <ArrowRight className="size-4 sm:size-5" />
            </button>
          </div>
          {err && !open && <p className="mt-3 text-sm text-red-600">{err}</p>}
          {notes}
        </form>
      ) : (
        <form onSubmit={start} className="mx-auto max-w-2xl rounded-2xl border bg-card p-6 shadow-sm">
          <label htmlFor="removal-url" className="text-sm font-medium">Paste URL for Removal</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input id="removal-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/content" className="h-12" />
            <Button type="submit" size="lg" className="h-12">Analyze Link <ArrowRight className="size-4" /></Button>
          </div>
          {err && !open && <p className="mt-2 text-sm text-destructive">{err}</p>}
          {notes}
        </form>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => busy && e.preventDefault()}>
          {step === "analyzing" && (<><DialogTitle>Eterna AI is analyzing this link</DialogTitle><DialogDescription>Reading the public page. This takes a few seconds.</DialogDescription><Stages busy /></>)}

          {step === "analyzed" && a && (<>
            <DialogTitle>Link analysis complete</DialogTitle>
            <div className="rounded-lg border px-4">
              <Row k="Platform" v={a.platform} /><Row k="Content type" v={a.contentType} />
              <Row k="Account / publisher" v={a.publisher} /><Row k="Page title" v={a.title} />
              <Row k="Submitted URL" v={a.url} /><Row k="Potential issue category" v={a.potentialCategory} />
            </div>
            {!a.reachable && <p className="text-xs text-muted-foreground">The page limited public access, so some details could not be read.</p>}
            <p className="text-sm">We need a few details from you to complete the assessment.</p>
            <Button onClick={() => setStep("affects")}>Continue</Button>
          </>)}

          {step === "affects" && (<>
            <DialogTitle>Who does this content affect?</DialogTitle><p className="text-xs text-muted-foreground">Step 1 of 3</p>
            <Choice items={AFFECTS} value={affects} onPick={setAffects} />
            <Button disabled={!affects} onClick={() => setStep("issue")}>Next</Button>
          </>)}

          {step === "issue" && (<>
            <DialogTitle>What is wrong with this content?</DialogTitle><p className="text-xs text-muted-foreground">Step 2 of 3</p>
            <Choice items={ISSUES} value={issue} onPick={setIssue} />
            <label className="text-sm font-medium">Explain the issue</label>
            <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value.slice(0, 3000))} placeholder="Briefly explain why you are requesting removal." rows={4} />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
              <FileUp className="size-4 text-primary" />
              <span>{files.length ? files.map((f) => f.name).join(", ") : "Upload Supporting Evidence (JPG, PNG, PDF, DOC/DOCX · up to 3 files, 5 MB each)"}</span>
              <input type="file" multiple accept={ACCEPT} className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).filter((f) => f.size <= 5 * 1024 * 1024).slice(0, 3))} />
            </label>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep("affects")}>Back</Button>
              <Button className="flex-1" disabled={!issue || explanation.trim().length < 10} onClick={() => setStep("contact")}>Next</Button></div>
          </>)}

          {step === "contact" && (<>
            <DialogTitle>Your contact details</DialogTitle><p className="text-xs text-muted-foreground">Step 3 of 3</p>
            <Input placeholder="Full Name" value={c.fullName} onChange={(e) => setC({ ...c, fullName: e.target.value })} />
            <Input placeholder="Email" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
            <Input placeholder="WhatsApp / Phone" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
            <Input placeholder="Country" value={c.country} onChange={(e) => setC({ ...c, country: e.target.value })} />
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
              I confirm that the information I provided is accurate and that I have a legitimate relationship to or authority over the affected person, brand or work.
            </label>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep("issue")}>Back</Button>
              <Button className="flex-1" disabled={!contactOk} onClick={assess}>Submit for Assessment</Button></div>
          </>)}

          {step === "assessing" && (<><DialogTitle>Assessing your case</DialogTitle><DialogDescription>Matching your details to the right removal pathway.</DialogDescription><Stages busy /></>)}

          {step === "result" && r && a && (<>
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-primary/10 animate-in zoom-in"><ShieldCheck className="size-7 text-primary" /></div>
            <DialogTitle className="text-center">Eligible for Removal Processing</DialogTitle>
            <div className="rounded-lg border px-4">
              <Row k="Submitted URL" v={a.url} /><Row k="Platform" v={a.platform} /><Row k="Content type" v={a.contentType} />
              <Row k="Issue" v={issue} /><Row k="Recommended route" v={r.recommendedRoute} />
              <Row k="Processing category" v="Pay-per-link · single URL" />
            </div>
            <p className="text-sm text-muted-foreground">{r.summary}</p>
            <div className="flex items-center justify-between rounded-lg bg-muted p-3"><span className="text-sm">Pay-Per-Link Service Fee</span><span className="text-lg font-semibold">{fee}</span></div>
            <p className="text-xs text-muted-foreground">Eligible for processing does not mean removal is guaranteed. The platform makes the final decision.</p>
            <Button onClick={() => setStep("checkout")}>Proceed to Payment</Button>
          </>)}

          {step === "checkout" && r && a && (<>
            <DialogTitle>Removal Order Summary</DialogTitle><p className="text-sm font-medium">Choose Preferred Payment Method</p>
            <div className="rounded-lg border px-4">
              <Row k="Submitted URL" v={a.url} /><Row k="Platform" v={a.platform} />
              <Row k="Removal category" v={issue} /><Row k="Case type" v={affects} /><Row k="Total" v={fee} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([["card", "Card", CreditCard], ["apple_pay", "Apple Pay", Smartphone], ["google_pay", "Google Pay", Smartphone]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" onClick={() => setMethod(id)}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs transition ${method === id ? "border-primary bg-primary/5" : ""}`}>
                  <Icon className="size-4" />{label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">No payment is taken on this website. Our team will send an invoice to {c.email}. Removal processing begins after payment is confirmed.</p>
            <Button onClick={pay}>Request Invoice & Create Case</Button>
          </>)}

          {step === "done" && r && a && (<>
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-primary/10 animate-in zoom-in"><Check className="size-7 text-primary" /></div>
            <DialogTitle className="text-center">Case Created — Awaiting Payment</DialogTitle>
            <DialogDescription className="text-center">Your case has been created. Our team will send payment instructions to your registered contact details. Removal processing begins after payment is confirmed.</DialogDescription>
            <div className="rounded-lg border px-4">
              <Row k="Case ID" v={r.caseId} /><Row k="Submitted URL" v={a.url} /><Row k="Platform" v={a.platform} />
              <Row k="Case type" v={issue} /><Row k="Payment" v="Awaiting invoice" />
            </div>
            <Button asChild><Link to="/track-case" search={{ case: r.caseId }}>Track this case</Link></Button>
          </>)}

          {step === "error" && (<>
            <DialogTitle>Something went wrong</DialogTitle><DialogDescription>{err}</DialogDescription>
            <Button onClick={() => setOpen(false)}>Close and retry</Button>
          </>)}
        </DialogContent>
      </Dialog>
    </>
  );
}
