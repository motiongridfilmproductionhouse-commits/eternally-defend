import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
// Google OAuth via supabase directly (no lovable broker in this project)
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign In — Eterna AI" }] }),
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
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/intelligence" });
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const fn = mode === "signin" ? supabase.auth.signInWithPassword : supabase.auth.signUp;
      const { error } = await fn.call(supabase.auth, {
        email, password,
        options: mode === "signup" ? { emailRedirectTo: window.location.origin } : undefined,
      } as any);
      if (error) throw error;
      navigate({ to: "/intelligence" });
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
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <Card className="w-full max-w-md p-6 space-y-5">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-xl grid place-items-center bg-primary/10 text-primary"><Shield className="size-5" /></div>
          <div>
            <div className="font-semibold">Eterna AI</div>
            <div className="text-xs text-muted-foreground">Multimedia Intelligence Engine</div>
          </div>
        </div>
        <div className="flex text-sm gap-2">
          <button type="button" onClick={() => setMode("signin")} className={`flex-1 py-2 rounded-lg border ${mode === "signin" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Sign in</button>
          <button type="button" onClick={() => setMode("signup")} className={`flex-1 py-2 rounded-lg border ${mode === "signup" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Create account</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input type="email" required placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="password" required minLength={6} placeholder="Password (min 6)" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="text-xs text-destructive">{error}</div>}
          <Button type="submit" disabled={loading} className="w-full">{loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}</Button>
        </form>
        <div className="relative text-xs text-muted-foreground text-center">
          <span className="px-2 bg-background relative z-10">or</span>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={handleGoogle}>Continue with Google</Button>
        <p className="text-[11px] text-muted-foreground">Signing in unlocks the Multimedia Intelligence Engine and saves your analysis history.</p>
      </Card>
    </div>
  );
}
