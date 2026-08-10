import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClientEnforcementSettings, updateClientEnforcementSettings } from "@/lib/auto-enforcement.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Bot, CheckCircle2, AlertTriangle, XCircle, Sliders } from "lucide-react";
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
    { key: "copyright", label: "Copyright Infringements", desc: "Original videos, photos, audio, and trademark rights" },
    { key: "impersonation", label: "Identity Impersonation", desc: "Fake profiles, squatted channels, and impersonating accounts" },
    { key: "deepfake", label: "Deepfakes & Synthetic Media", desc: "AI generated image/video/audio likeness misuse" },
    { key: "privacy", label: "Privacy Violations & Doxxing", desc: "Personal information, private photos, and doxxing" },
    { key: "harassment", label: "Harassment & Defamation", desc: "Abusive campaigns and defamatory statements" },
    { key: "legal_escalation", label: "Legal Escalations", desc: "Formal legal notices and subpoena proceedings (Manual only)" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-background border-border text-foreground rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Bot className="size-5 text-primary" /> Automatic Enforcement Configuration
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Control automated backend enforcement eligibility rules per policy basis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Global Toggle */}
          <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="font-semibold text-sm flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Automatic Enforcement Engine
              </div>
              <div className="text-xs text-muted-foreground">
                Automatically process eligible verified findings without manual URL selection.
              </div>
            </div>
            <Switch
              checked={autoEnabled}
              onCheckedChange={setAutoEnabled}
            />
          </div>

          {/* Granular Policies */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="size-3.5" /> Enforcement Rules by Category
            </div>

            {categories.map((cat) => (
              <div key={cat.key} className="p-3 border border-border rounded-xl flex items-center justify-between text-xs gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground">{cat.label}</div>
                  <div className="text-muted-foreground truncate">{cat.desc}</div>
                </div>

                <select
                  value={policies[cat.key] || "AUTO"}
                  onChange={(e) => setPolicies({ ...policies, [cat.key]: e.target.value })}
                  disabled={cat.key === "legal_escalation"}
                  className="bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="AUTO">AUTO (Automatic submission)</option>
                  <option value="REVIEW">REVIEW (Requires review queue)</option>
                  <option value="MANUAL">MANUAL ONLY</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            Save Configuration
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
