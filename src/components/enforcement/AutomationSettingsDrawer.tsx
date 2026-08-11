import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClientEnforcementSettings, updateClientEnforcementSettings } from "@/lib/auto-enforcement.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Bot,
  Sliders,
  Shield,
  UserCheck,
  Cpu,
  Lock,
  AlertOctagon,
  FileText,
  Server,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AutomationSettingsDrawer({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const getSettingsFn = useServerFn(getClientEnforcementSettings);
  const updateSettingsFn = useServerFn(updateClientEnforcementSettings);

  const formInitializedRef = useRef(false);

  const settingsQuery = useQuery({
    queryKey: ["client_enforcement_settings"],
    queryFn: () => getSettingsFn(),
    enabled: open,
  });

  const settings = settingsQuery.data?.settings;
  const [autoEnabled, setAutoEnabled] = useState<boolean>(settings?.automatic_enforcement_enabled ?? false);
  const [policies, setPolicies] = useState<Record<string, string>>(
    (settings?.enforcement_basis_policies as Record<string, string>) || {
      copyright: "AUTO",
      impersonation: "AUTO",
      deepfake: "AUTO",
      privacy: "REVIEW",
      harassment: "REVIEW",
      legal_escalation: "MANUAL",
    }
  );

  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialize local form state ONLY ONCE per modal open cycle
  useEffect(() => {
    if (!open) {
      formInitializedRef.current = false;
      setSaveError(null);
      return;
    }

    if (!settings || formInitializedRef.current) {
      return;
    }

    console.log("[DEV DIAGNOSTIC] Initializing form from loaded DB settings:", settings.automatic_enforcement_enabled);

    setAutoEnabled(Boolean(settings.automatic_enforcement_enabled));

    if (settings.enforcement_basis_policies) {
      setPolicies(settings.enforcement_basis_policies as Record<string, string>);
    }

    formInitializedRef.current = true;
  }, [open, settings]);

  const handleAutoEnabledChange = (checked: boolean) => {
    console.log("[DEV DIAGNOSTIC] Master switch toggled to:", checked);
    setSaveError(null);
    setAutoEnabled(checked);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      console.log("[DEV DIAGNOSTIC] Executing updateSettingsFn with payload:", {
        automaticEnforcementEnabled: autoEnabled,
        enforcementBasisPolicies: policies,
      });

      const res = await updateSettingsFn({
        data: {
          automaticEnforcementEnabled: autoEnabled,
          enforcementBasisPolicies: policies,
        },
      });

      if (!res || !res.settings) {
        throw new Error("SAVE_VERIFICATION_FAILED: No settings record returned from server.");
      }

      const returnedState = Boolean(res.settings.automatic_enforcement_enabled);
      if (returnedState !== autoEnabled) {
        throw new Error(`SAVE_VERIFICATION_FAILED: Server returned automatic_enforcement_enabled = ${returnedState} but requested ${autoEnabled}`);
      }

      return res;
    },
    onSuccess: async (res) => {
      console.log("[DEV DIAGNOSTIC] Mutation succeeded & verified. Returned DB setting:", res?.settings?.automatic_enforcement_enabled);
      setSaveError(null);
      toast.success("Enforcement automation settings saved & verified");
      await qc.invalidateQueries({ queryKey: ["client_enforcement_settings"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[DEV DIAGNOSTIC] Mutation error:", msg);
      setSaveError(msg);
      toast.error(`AUTOMATION SETTINGS NOT SAVED: ${msg}`);
    },
  });

  const categories = [
    {
      key: "copyright",
      label: "Copyright Infringements",
      desc: "Original videos, photos, audio and protected creative works",
      icon: Shield,
      autoBadge: "WEBSITE DMCA • Automatic processing",
    },
    {
      key: "impersonation",
      label: "Identity Impersonation",
      desc: "Fake profiles, channels and impersonating accounts",
      icon: UserCheck,
      autoBadge: "AUTO EVALUATION • Human submission required",
    },
    {
      key: "deepfake",
      label: "Deepfakes & Synthetic Media",
      desc: "AI-generated image, video and audio likeness misuse",
      icon: Cpu,
      autoBadge: "AUTO EVALUATION • Human submission required",
    },
    {
      key: "privacy",
      label: "Privacy Violations & Doxxing",
      desc: "Personal information and private-content exposure",
      icon: Lock,
      autoBadge: "AUTO EVALUATION • Human submission required",
    },
    {
      key: "harassment",
      label: "Harassment & Defamation",
      desc: "Abusive campaigns and potentially defamatory content",
      icon: AlertOctagon,
      autoBadge: "AUTO EVALUATION • Human submission required",
    },
    {
      key: "legal_escalation",
      label: "Legal Escalations",
      desc: "Formal legal notices and subpoena proceedings",
      icon: FileText,
      autoBadge: "MANUAL ONLY",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-3xl p-6 shadow-xl max-h-[calc(100vh-3rem)] flex flex-col gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold tracking-tight font-mono text-slate-950 dark:text-white">
              <Bot className="size-5 text-blue-600 dark:text-blue-400" /> AUTOMATION CONTROL
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Configure how Eterna responds when verified threats are detected.
            </DialogDescription>
          </div>

          <div className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono">
            <span className="size-1.5 rounded-full bg-blue-500" />
            CONTROLLED TEST MODE
          </div>
        </DialogHeader>

        {/* Query Error Notice */}
        {settingsQuery.isError && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-mono rounded-xl flex items-center gap-2 mt-3">
            <AlertTriangle className="size-4 shrink-0 text-rose-600" />
            <span>
              SETTINGS LOAD FAILED: {settingsQuery.error instanceof Error ? settingsQuery.error.message : String(settingsQuery.error)}
            </span>
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
          {/* Master Engine Control Card */}
          <div className="bg-gradient-to-r from-blue-50/80 via-white to-slate-50/50 dark:from-blue-950/20 dark:via-slate-900 dark:to-slate-900 border border-blue-200/70 dark:border-blue-900/50 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="font-bold text-sm text-slate-950 dark:text-white font-mono flex items-center gap-2">
                <ShieldCheck className="size-4 text-blue-600 dark:text-blue-400" /> AUTOMATIC ENFORCEMENT ENGINE
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                Automatically evaluate verified findings and initiate permitted actions.
              </div>
              <div className="text-[10px] font-mono text-blue-600 dark:text-blue-400 font-medium pt-0.5">
                Controlled Test Mode • External recipients protected
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-[11px] font-bold font-mono px-2.5 py-0.5 rounded-full border ${autoEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800" : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"}`}>
                {autoEnabled ? "● AUTOMATION ACTIVE" : "● PAUSED"}
              </span>
              <Switch
                checked={autoEnabled}
                onCheckedChange={handleAutoEnabledChange}
                disabled={settingsQuery.isLoading || updateMutation.isPending}
                className="data-[state=checked]:bg-blue-600"
              />
            </div>
          </div>

          {/* Clean Flat Category Settings List */}
          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono mb-2 flex items-center gap-1.5 px-1">
              <Sliders className="size-3.5 text-blue-600" /> ENFORCEMENT RULES BY CATEGORY
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {categories.map((cat) => {
                const IconComponent = cat.icon;
                const currentMode = policies[cat.key] || "AUTO";
                const isLegalEscalation = cat.key === "legal_escalation";

                return (
                  <div
                    key={cat.key}
                    className="py-3.5 px-1 flex items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="size-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700 grid place-items-center shrink-0">
                        <IconComponent className="size-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-slate-900 dark:text-white truncate">{cat.label}</span>
                          {currentMode === "AUTO" && (
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                              • {cat.autoBadge}
                            </span>
                          )}
                          {currentMode === "REVIEW" && (
                            <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400">
                              • Human approval required
                            </span>
                          )}
                          {currentMode === "MANUAL" && (
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                              • Manual action only
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{cat.desc}</div>
                      </div>
                    </div>

                    {/* Compact Segmented Control (Height: 34px) */}
                    <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shrink-0 h-8">
                      <button
                        type="button"
                        disabled={isLegalEscalation}
                        onClick={() => setPolicies({ ...policies, [cat.key]: "AUTO" })}
                        className={`h-7 px-2.5 rounded-md text-[11px] font-bold font-mono transition-all ${currentMode === "AUTO" ? "bg-blue-600 text-white shadow-xs" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"}`}
                      >
                        AUTO
                      </button>

                      <button
                        type="button"
                        disabled={isLegalEscalation}
                        onClick={() => setPolicies({ ...policies, [cat.key]: "REVIEW" })}
                        className={`h-7 px-2.5 rounded-md text-[11px] font-bold font-mono transition-all ${currentMode === "REVIEW" ? "bg-amber-500 text-white shadow-xs" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"}`}
                      >
                        REVIEW
                      </button>

                      <button
                        type="button"
                        onClick={() => setPolicies({ ...policies, [cat.key]: "MANUAL" })}
                        className={`h-7 px-2.5 rounded-md text-[11px] font-bold font-mono transition-all ${currentMode === "MANUAL" ? "bg-slate-700 text-white shadow-xs" : "text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}
                      >
                        MANUAL
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Compact Safety Strip */}
          <div className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="font-bold text-slate-800 dark:text-slate-200 font-mono text-[11px] flex items-center gap-1.5">
              <Server className="size-3.5 text-blue-600" /> PRODUCTION SAFETY STATUS
            </div>
            <div className="flex flex-wrap items-center gap-4 text-slate-500 dark:text-slate-400 text-[10px] font-mono">
              <span>Controlled Test Mode: <strong className="text-blue-600 dark:text-blue-400">ACTIVE</strong></span>
              <span>External Recipient Sending: <strong className="text-slate-700 dark:text-slate-200">BLOCKED</strong></span>
              <span>Kill Switch: <strong className="text-emerald-600 dark:text-emerald-400">ACTIVE</strong></span>
            </div>
          </div>
        </div>

        {/* Inline Save Error Alert */}
        {saveError && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-mono rounded-xl flex items-center gap-2 shrink-0">
            <AlertTriangle className="size-4 shrink-0 text-rose-600" />
            <div className="flex-1">
              <strong>AUTOMATION SETTINGS NOT SAVED:</strong> {saveError}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <span className="text-[11px] text-slate-400 dark:text-slate-500 font-sans">
            Changes affect future enforcement evaluations.
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white shadow-sm rounded-xl font-semibold px-4"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
