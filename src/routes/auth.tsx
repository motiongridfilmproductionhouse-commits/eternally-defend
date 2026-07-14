import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldHalf } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Sign In — Eterna AI" },
    { name: "description", content: "Sign in to Eterna AI — AI-powered digital protection, content fingerprinting and automated takedowns." },
  ]}),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/onboarding` },
        });
        if (error) throw error;
        // If email confirmation is disabled, session exists immediately.
        if (data.session) navigate({ to: "/onboarding" });
        else setError("Check your email to confirm your account, then sign in.");
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
    } finally { setLoading(false); }
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
      <div className="relative hidden md:flex flex-col justify-between p-10 text-white overflow-hidden"
        style={{ background: "linear-gradient(135deg, #071B4A 0%, #1037A6 55%, #1E5EFF 100%)" }}
      >
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-2xl grid place-items-center bg-white/15 backdrop-blur">
            <ShieldHalf className="size-6" />
          </div>
          <div>
            <div className="font-display font-bold text-xl leading-tight">Eterna AI</div>
            <div className="text-[10px] tracking-[0.22em] text-white/70 font-semibold">DIGITAL PROTECTION</div>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="font-display text-[44px] leading-[1.05] font-bold tracking-tight">Own it. Protect it. Defend it.</h1>
          <p className="mt-5 text-white/80 leading-relaxed">
            AI-powered enforcement across 12+ platforms. Content fingerprinting, identity verification, and automated takedowns in one dashboard.
          </p>
          <ul className="mt-8 space-y-2.5 text-white/90 text-sm">
            {[
              "SHA-256 + perceptual content fingerprints",
              "Immutable ownership certificates",
              "AI co-pilot for DMCA & legal drafting",
            ].map((line) => (
              <li key={line} className="flex items-center gap-2">
                <span className="text-white/70">✓</span>{line}
              </li>
            ))}
          </ul>
        </div>

        <div className="text-xs text-white/60">Trusted by creators, public figures and enterprise brands.</div>
      </div>

      {/* Right — form panel */}
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="md:hidden flex items-center gap-3 mb-2">
            <div className="size-10 rounded-xl grid place-items-center text-white"
              style={{ background: "linear-gradient(135deg, #1037A6, #1E5EFF)" }}>
              <ShieldHalf className="size-5" />
            </div>
            <div className="font-display font-bold text-lg">Eterna AI</div>
          </div>

          <div>
            <h2 className="font-display font-bold text-3xl tracking-tight">
              {mode === "signin" ? "Welcome back" : "Create account"}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {mode === "signin" ? "Sign in to your Eterna AI workspace." : "Get started with your Eterna AI workspace."}
            </p>
          </div>

          <Button type="button" variant="outline" className="w-full h-11" onClick={handleGoogle}>
            <GoogleIcon className="size-4 mr-2" />
            Continue with Google
          </Button>

          <div className="relative text-xs text-muted-foreground text-center">
            <span className="px-3 bg-background relative z-10 tracking-[0.18em] font-medium">OR</span>
            <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <Input type="email" required placeholder="Email" className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" required minLength={6} placeholder="Password" className="h-11" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <div className="text-xs text-destructive">{error}</div>}
            <Button type="submit" disabled={loading} className="w-full h-11 text-base font-semibold"
              style={{ background: "linear-gradient(90deg, #2563EB, #3B82F6)" }}>
              {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            {mode === "signin" ? "New to Eterna? " : "Already have an account? "}
            <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-semibold text-primary hover:underline" style={{ color: "#3B82F6" }}>
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.86 6.86 0 0 1 0-4.2V7.07H2.18a11 11 0 0 0 0 9.87l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
