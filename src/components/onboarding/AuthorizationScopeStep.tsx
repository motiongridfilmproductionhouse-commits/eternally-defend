import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ChevronRight, ChevronLeft, ShieldAlert, CheckCircle2, AlertTriangle } from "lucide-react";
import { getAuthorizationBundle, saveScopes } from "@/lib/onboarding/authorization.functions";

const SCOPES = [
  { key: "monitor_public", label: "Public content monitoring" },
  { key: "monitor_verified_assets", label: "Verified asset monitoring" },
  { key: "detect_face_misuse", label: "Face and identity misuse detection" },
  { key: "collect_evidence", label: "Screenshot and evidence collection" },
  { key: "monitoring_reports", label: "Monitoring report generation" },
  { key: "prepare_copyright", label: "Copyright complaint preparation" },
  { key: "prepare_privacy", label: "Privacy complaint preparation" },
  { key: "prepare_impersonation", label: "Impersonation complaint preparation" },
  { key: "prepare_hosting", label: "Hosting-provider complaint preparation" },
  { key: "communicate_platforms", label: "Platform/service-provider communication" },
  { key: "track_enforcement", label: "Case tracking" },
  { key: "follow_up_cases", label: "Follow-up communications" },
  { key: "submit_final_after_approval", label: "Final complaint submission only after separate approval" },
] as const;

export function AuthorizationScopeStep({
  onBack,
  onNext
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const save = useServerFn(saveScopes);

  const { data: authBundle, isLoading } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuth(),
  });

  const [scopes, setScopes] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"IDLE" | "SAVING" | "SAVED">("IDLE");
  const initRef = useRef(false);

  // Initialize from backend
  useEffect(() => {
    if (authBundle && !initRef.current) {
      const initial: Record<string, boolean> = {};
      SCOPES.forEach(s => { initial[s.key] = false; });
      authBundle.scopes?.forEach((s: any) => {
        if (s.granted) initial[s.scope_key] = true;
      });
      // Default to all selected if this is the first time (no scopes saved at all yet)
      if (!authBundle.scopes || authBundle.scopes.length === 0) {
        SCOPES.forEach(s => { initial[s.key] = true; });
      }
      setScopes(initial);
      initRef.current = true;
    }
  }, [authBundle]);

  const selectedCount = Object.values(scopes).filter(Boolean).length;
  const isValid = selectedCount > 0;

  // Auto-save logic
  const handleToggle = async (key: string, checked: boolean) => {
    const next = { ...scopes, [key]: checked };
    setScopes(next);
    
    // Only autosave if valid
    const cnt = Object.values(next).filter(Boolean).length;
    if (cnt > 0) {
      setSaveStatus("SAVING");
      setSaving(true);
      try {
        await save({ data: { scopes: next } });
        setSaveStatus("SAVED");
        setTimeout(() => setSaveStatus("IDLE"), 3000);
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to save scopes");
        setSaveStatus("IDLE");
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <CardTitle className="text-xl">Authorization Scope</CardTitle>
        <CardDescription className="text-white/60">
          Select the permissions you wish to grant Eterna AI to act on your behalf. We will only act within these specific permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {isLoading && !initRef.current ? (
          <div className="py-10 flex justify-center"><Loader2 className="size-6 animate-spin text-blue-500" /></div>
        ) : (
          <>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3 text-sm text-blue-200">
              <ShieldAlert className="size-5 shrink-0 text-blue-400 mt-0.5" />
              <div>
                <strong className="text-blue-300 block mb-1">Important Notice</strong>
                Eterna AI requires at least one authorization scope to function. Note that enabling complaint preparation does not mean automatic submission; final platform submission requires your separate manual approval for each case.
              </div>
            </div>

            <div className="space-y-3 bg-white/5 border border-white/10 p-4 rounded-xl max-h-[400px] overflow-y-auto custom-scrollbar">
              {SCOPES.map((s) => (
                <label key={s.key} className="flex gap-3 items-start cursor-pointer hover:bg-white/5 p-2 rounded-md transition-colors">
                  <Checkbox 
                    checked={scopes[s.key] || false} 
                    onCheckedChange={(v) => handleToggle(s.key, !!v)} 
                    className="mt-0.5 border-white/30 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white" 
                  />
                  <div className="text-sm text-white/90 leading-relaxed">
                    {s.label}
                    {s.key === "submit_final_after_approval" && (
                      <span className="block text-xs text-orange-400 mt-1 flex items-center gap-1">
                        <AlertTriangle className="size-3" /> Eterna will never submit without your review.
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between bg-black/20 rounded-lg p-3 border border-white/5 text-sm">
              <div className="text-white/60">
                Selected: <strong className="text-white">{selectedCount}</strong> / {SCOPES.length} permissions
              </div>
              <div>
                {saveStatus === "SAVING" && <span className="text-blue-400 flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Saving...</span>}
                {saveStatus === "SAVED" && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="size-3" /> Saved automatically</span>}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10" disabled={saving}>
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <Button onClick={onNext} disabled={!isValid || saving} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
            Continue <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
