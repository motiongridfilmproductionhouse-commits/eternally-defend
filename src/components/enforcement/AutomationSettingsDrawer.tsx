import { useState } from "react";
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
  CheckCircle2,
  Server,
  Activity,
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

  // Sync state when query resolves
  if (settings && autoEnabled !== settings.automatic_enforcement_enabled && !settingsQuery.isFetching) {
    setAutoEnabled(settings.automatic_enforcement_enabled);
    if (settings.enforcement_basis_policies) {
      setPolicies(settings.enforcement_basis_policies as Record<string, string>);
    }
  }

  const updateMutation = useMutation({
    mutationFn: async () => {
      return await updateSettingsFn({
        data: {
          automaticEnforcementEnabled: autoEnabled,
          enforcementBasisPolicies: policies,
        },
      });
    },
    onSuccess: () => {
      toast.success("Enforcement automation settings updated");
      qc.invalidateQueries({ queryKey: ["client_enforcement_settings"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to update settings");
    },
  });

  const categories = [
    {
      key: "copyright",
      label: "Copyright Infringements",
      desc: "Original videos, photos, audio and protected creative works",
      icon: Shield,
      autoSubtitle: "Auto processing (Website DMCA)",
    },
    {
      key: "impersonation",
      label: "Identity Impersonation",
      desc: "Fake profiles, channels and impersonating accounts",
      icon: UserCheck,
      autoSubtitle: "AUTO EVALUATION (Human submission required)",
    },
    {
      key: "deepfake",
      label: "Deepfakes & Synthetic Media",
      desc: "AI-generated image, video and audio likeness misuse",
      icon: Cpu,
      autoSubtitle: "AUTO EVALUATION (Human submission required)",
    },
    {
      key: "privacy",
      label: "Privacy Violations & Doxxing",
      desc: "Personal information and private-content exposure",
      icon: Lock,
      autoSubtitle: "AUTO EVALUATION (Human submission required)",
    },
    {
      key: "harassment",
      label: "Harassment & Defamation",
      desc: "Abusive campaigns and potentially defamatory content",
      icon: AlertOctagon,
      autoSubtitle: "AUTO EVALUATION (Human submission required)",
    },
    {
      key: "legal_escalation",
      label: "Legal Escalations",
      desc: "Formal legal notices and subpoena proceedings",
      icon: FileText,
      autoSubtitle: "Manual action only",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl md:max-w-4xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6">
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <DialogTitle className="flex items-center gap-2.5 text-xl font-bold tracking-tight font-mono text-slate-950 dark:text-white">
              <Bot className="size-6 text-blue-600 dark:text-blue-400" /> AUTOMATION CONTROL
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Configure how Eterna responds when verified threats are detected.
            </DialogDescription>
          </div>

          <div className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono">
            <span className="size-2 rounded-full bg-blue-500" />
            SYSTEM SAFETY • CONTROLLED TEST MODE
          </div>
        </DialogHeader>

        <div className="space-y-6 py-1">
          {/* Master Engine Control Card */}
          <div className="bg-gradient-to-br from-blue-50/80 via-white to-slate-50/50 dark:from-blue-950/30 dark:via-slate-900 dark:to-slate-900 border border-blue-200/80 dark:border-blue-900/60 rounded-2xl p-5 md:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
            <div className="space-y-1 relative z-10">
              <div className="font-bold text-base text-slate-950 dark:text-white font-mono flex items-center gap-2">
                <ShieldCheck className="size-5 text-blue-600 dark:text-blue-400" /> AUTOMATIC ENFORCEMENT ENGINE
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 max-w-lg font-normal">
                Automatically evaluate verified findings and initiate permitted actions across protected assets.
              </div>
              <div className="text-[11px] font-mono text-blue-600 dark:text-blue-400 font-medium pt-1">
                Controlled Test Mode • External recipients protected
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0 relative z-10">
              <span className={`text-xs font-bold font-mono px-3 py-1 rounded-full border ${autoEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800" : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"}`}>
                {autoEnabled ? "● AUTOMATION ACTIVE" : "● PAUSED"}
              </span>
              <Switch
                checked={autoEnabled}
                onCheckedChange={setAutoEnabled}
                className="data-[state=checked]:bg-blue-600"
              />
            </div>
          </div>

          {/* Category Policy Cards */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider font-mono flex items-center gap-2">
              <Sliders className="size-4 text-blue-600" /> ENFORCEMENT RULES BY CATEGORY
            </div>

            <div className="grid grid-cols-1 gap-3">
              {categories.map((cat) => {
                const IconComponent = cat.icon;
                const currentMode = policies[cat.key] || "AUTO";
                const isLegalEscalation = cat.key === "legal_escalation";

                return (
                  <div
                    key={cat.key}
                    className="p-4 border border-slate-200/80 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm hover:border-blue-500/30 transition-all duration-200"
                  >
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      <div className="size-10 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700 grid place-items-center shrink-0 mt-0.5">
                        <IconComponent className="size-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-bold text-sm text-slate-950 dark:text-white">{cat.label}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{cat.desc}</div>
                        {currentMode === "AUTO" && (
                          <div className="text-[11px] font-mono text-blue-600 dark:text-blue-400 font-medium pt-0.5">
                            {cat.autoSubtitle}
                          </div>
                        )}
                        {currentMode === "REVIEW" && (
                          <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400 font-medium pt-0.5">
                            Human approval required
                          </div>
                        )}
                        {currentMode === "MANUAL" && (
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 font-medium pt-0.5">
                            Manual action only
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Segmented Mode Selector */}
                    <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 self-start md:self-center">
                      <button
                        type="button"
                        disabled={isLegalEscalation}
                        onClick={() => setPolicies({ ...policies, [cat.key]: "AUTO" })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${currentMode === "AUTO" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white disabled:opacity-40"}`}
                      >
                        AUTO
                      </button>

                      <button
                        type="button"
                        disabled={isLegalEscalation}
                        onClick={() => setPolicies({ ...policies, [cat.key]: "REVIEW" })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${currentMode === "REVIEW" ? "bg-amber-500 text-white shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white disabled:opacity-40"}`}
                      >
                        REVIEW
                      </button>

                      <button
                        type="button"
                        onClick={() => setPolicies({ ...policies, [cat.key]: "MANUAL" })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${currentMode === "MANUAL" ? "bg-slate-700 text-white shadow-sm" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}
                      >
                        MANUAL
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Safety Panel */}
          <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
              <Server className="size-4 text-blue-600" /> PRODUCTION SAFETY STATUS
            </div>
            <div className="flex flex-wrap items-center gap-4 text-slate-600 dark:text-slate-300 font-medium text-[11px] font-mono">
              <span className="flex items-center gap-1.5">
                Controlled Test Mode: <strong className="text-blue-600 dark:text-blue-400">ACTIVE</strong>
              </span>
              <span className="flex items-center gap-1.5">
                External Recipient Sending: <strong className="text-slate-700 dark:text-slate-200">BLOCKED</strong>
              </span>
              <span className="flex items-center gap-1.5">
                Kill Switch: <strong className="text-emerald-600 dark:text-emerald-400">ACTIVE</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <span className="text-xs text-slate-400 dark:text-slate-500 font-sans">
            Changes affect future enforcement evaluations.
          </span>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              className="text-xs rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm rounded-xl font-semibold px-5"
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
