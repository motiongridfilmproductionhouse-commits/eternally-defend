import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Briefcase,
  Building2,
  Camera,
  ChevronRight,
  Info,
  Loader2,
  Megaphone,
  Scale,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { selectV2AccountType } from "@/lib/onboarding/v2-profile.functions";
import { isLightVerificationAccount, type V2AccountType } from "@/lib/onboarding/v2-config";
import { VERIFICATION_OPTIONAL_MESSAGE } from "@/lib/verification/verification-status";

const OPTIONS: Array<{
  value: V2AccountType;
  title: string;
  description: string;
  icon: typeof UserRound;
}> = [
  {
    value: "celebrity",
    title: "Celebrity / Public Figure",
    description: "Public figures, artists and recognized personalities.",
    icon: Camera,
  },
  {
    value: "manager_agent",
    title: "Manager / Agent",
    description: "Manage protection on behalf of a public figure.",
    icon: Briefcase,
  },
  {
    value: "pr_team",
    title: "PR / Reputation Team",
    description: "Communications teams monitoring public perception.",
    icon: Megaphone,
  },
  {
    value: "legal_representative",
    title: "Legal Representative",
    description: "Counsel acting for a client's rights and reputation.",
    icon: Scale,
  },
  {
    value: "enterprise",
    title: "Brand / Organization",
    description: "Registered businesses and corporate organizations.",
    icon: Building2,
  },
  {
    value: "individual",
    title: "Individual",
    description: "Personal identity, reputation and likeness protection.",
    icon: UserRound,
  },
];

export function AccountTypeStep({ onSelected }: { onSelected: () => Promise<void> | void }) {
  const choose = useServerFn(selectV2AccountType);
  const [selected, setSelected] = useState<V2AccountType | null>(null);
  const [busy, setBusy] = useState(false);

  const handleContinue = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await choose({ data: { account_type: selected } });
      await onSelected();
      toast.success("Account type saved.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to save account type");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Choose your protection account</CardTitle>
        <CardDescription className="text-white/60">
          Your selection creates a setup path matched to the rights you need to protect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = selected === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelected(option.value)}
                className={`min-h-32 rounded-lg border p-4 text-left transition ${active ? "border-blue-400 bg-blue-500/15" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
              >
                <Icon className={`mb-4 size-6 ${active ? "text-blue-300" : "text-white/50"}`} />
                <div className="font-semibold">{option.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-white/55">
                  {option.description}
                </div>
              </button>
            );
          })}
        </div>

        {isLightVerificationAccount(selected) && (
          <div className="flex items-start gap-3 rounded-lg border border-blue-400/25 bg-blue-500/10 p-4 text-xs leading-relaxed text-blue-100">
            <Info className="mt-0.5 size-4 shrink-0 text-blue-300" />
            <span>{VERIFICATION_OPTIONAL_MESSAGE}</span>
          </div>
        )}

        <div className="flex justify-end border-t border-white/10 pt-4">
          <Button
            onClick={handleContinue}
            disabled={!selected || busy}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Continue{" "}
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
