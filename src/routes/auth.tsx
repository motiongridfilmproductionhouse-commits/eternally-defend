import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { verifyInviteCode, signUpWithInvite } from "@/lib/invites/invites.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldHalf, KeyRound } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign In — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Sign in to Eterna Sentinel — AI-powered digital protection, content fingerprinting and automated takedowns.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Invite gate — signup is only reachable after a code validates server-side.
  const [inviteCode, setInviteCode] = useState("");
  const [inviteAccepted, setInviteAccepted] = useState(false);
  const [inviteAccountType, setInviteAccountType] = useState<string | null>(null);
  const verifyInvite = useServerFn(verifyInviteCode);
  const signUpInvited = useServerFn(signUpWithInvite);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      // Route by onboarding status — dashboard gate would just bounce back here otherwise.
      const { data: profile } = await supabase
        .from("client_profiles")
        .select("onboarding_completed")
        .eq("user_id", data.session.user.id)
        .maybeSingle();
      navigate({ to: profile?.onboarding_completed ? "/" : "/onboarding" });
    });
  }, [navigate]);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await verifyInvite({ data: { code: inviteCode } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInviteAccountType(res.accountType ?? null);
      if (res.assignedEmail) setEmail(res.assignedEmail);
      setInviteAccepted(true);
    } catch {
      setError("Could not validate the invitation code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        // Account creation happens server-side, gated by the invitation code.
        const res = await signUpInvited({ data: { code: inviteCode, email, password } });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/onboarding" });
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data: profile } = await supabase
          .from("client_profiles")
          .select("onboarding_completed")
          .eq("user_id", data.user.id)
          .maybeSingle();
        navigate({ to: profile?.onboarding_completed ? "/" : "/onboarding" });
      }
    } catch (e: any) {
      setError(e?.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  };


  const handleGoogle = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth` },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-background">
      {/* Left — brand panel */}
      <div
        className="relative hidden md:flex flex-col justify-between p-10 text-white overflow-hidden"
        style={{ background: "linear-gradient(135deg, #071B4A 0%, #1037A6 55%, #1E5EFF 100%)" }}
      >
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-2xl grid place-items-center bg-white/15 backdrop-blur">
            <ShieldHalf className="size-6" />
          </div>
          <div>
            <div className="font-display font-bold text-xl leading-tight">Eterna AI</div>
            <div className="text-[10px] tracking-[0.22em] text-white/70 font-semibold">
              DIGITAL PROTECTION
            </div>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="font-display text-[44px] leading-[1.05] font-bold tracking-tight">
            Own it. Protect it. Defend it.
          </h1>
          <p className="mt-5 text-white/80 leading-relaxed">
            AI-powered enforcement across 12+ platforms. Content fingerprinting, identity
            verification, and automated takedowns in one dashboard.
          </p>
          <ul className="mt-8 space-y-2.5 text-white/90 text-sm">
            {[
              "SHA-256 + perceptual content fingerprints",
              "Immutable ownership certificates",
              "AI co-pilot for DMCA & legal drafting",
            ].map((line) => (
              <li key={line} className="flex items-center gap-2">
                <span className="text-white/70">✓</span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="text-xs text-white/60">
          Trusted by creators, public figures and enterprise brands.
        </div>
      </div>

      {/* Right — form panel */}
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="md:hidden flex items-center gap-3 mb-2">
            <div
              className="size-10 rounded-xl grid place-items-center text-white"
              style={{ background: "linear-gradient(135deg, #1037A6, #1E5EFF)" }}
            >
              <ShieldHalf className="size-5" />
            </div>
            <div className="font-display font-bold text-lg">Eterna AI</div>
          </div>

          <div>
            <h2 className="font-display font-bold text-3xl tracking-tight">
              {mode === "signin"
                ? "Welcome back"
                : inviteAccepted
                  ? "Create account"
                  : "Enter invitation code"}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {mode === "signin"
                ? "Sign in to your Eterna AI workspace."
                : inviteAccepted
                  ? inviteAccountType
                    ? `Invitation verified · ${inviteAccountType} account.`
                    : "Invitation verified. Set up your credentials."
                  : "Eterna is invitation-only. Enter the code you received to continue."}
            </p>
          </div>

          {null}


          {mode === "signup" && !inviteAccepted ? (
            <form onSubmit={handleInviteSubmit} className="space-y-3">
              <Input
                required
                placeholder="ETRN-XXXX-XXXX-XXXX"
                className="h-11 font-mono tracking-wider"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              />
              {error && <div className="text-xs text-destructive">{error}</div>}
              <Button
                type="submit"
                disabled={loading || inviteCode.trim().length < 4}
                className="w-full h-11 text-base font-semibold"
                style={{ background: "linear-gradient(90deg, #2563EB, #3B82F6)" }}
              >
                <KeyRound className="size-4 mr-2" />
                {loading ? "Verifying…" : "Verify invitation"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="email"
                required
                placeholder="Email"
                className="h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                type="password"
                required
                minLength={mode === "signup" ? 8 : 6}
                placeholder="Password"
                className="h-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <div className="text-xs text-destructive">{error}</div>}
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 text-base font-semibold"
                style={{ background: "linear-gradient(90deg, #2563EB, #3B82F6)" }}
              >
                {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
          )}

          <p className="text-sm text-center text-muted-foreground">
            {mode === "signin" ? "Have an invitation code? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInviteAccepted(false);
                setInviteCode("");
                setInviteAccountType(null);
                setMode(mode === "signin" ? "signup" : "signin");
              }}
              className="font-semibold text-primary hover:underline"
              style={{ color: "#3B82F6" }}
            >
              {mode === "signin" ? "Create account" : "Sign in"}
            </button>

          </p>

          <div className="pt-4 border-t border-border">
            <a
              href="/partner-apply"
              className="block text-center text-sm font-semibold px-4 py-2.5 rounded-md border border-slate-300 hover:bg-slate-50 transition"
            >
              Become a Partner →
            </a>
            <p className="mt-2 text-[11px] text-center text-muted-foreground">
              Refer clients and earn 25% commission on Eterna Protection sales.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

