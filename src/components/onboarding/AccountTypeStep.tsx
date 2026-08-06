import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Camera, ChevronRight, Loader2, UserRound, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { selectV2AccountType } from "@/lib/onboarding/v2-profile.functions";
import type { V2AccountType } from "@/lib/onboarding/v2-config";

const OPTIONS: Array<{ value: V2AccountType; title: string; description: string; icon: typeof UserRound }> = [
  { value: "celebrity", title: "Celebrity", description: "Public figures, artists and recognized personalities.", icon: Camera },
  { value: "individual", title: "Individual", description: "Personal identity, reputation and likeness protection.", icon: UserRound },
  { value: "enterprise", title: "Enterprise", description: "Registered businesses and corporate organizations.", icon: Building2 },
  { value: "production_house", title: "Production House", description: "Studios, labels and rights-holding production teams.", icon: UsersRound },
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
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to save account type");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Choose your protection account</CardTitle>
        <CardDescription className="text-white/60">Your selection creates a verification path matched to the rights you need to protect.</CardDescription>
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
                <div className="mt-1 text-xs leading-relaxed text-white/55">{option.description}</div>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end border-t border-white/10 pt-4">
          <Button onClick={handleContinue} disabled={!selected || busy} className="bg-blue-600 text-white hover:bg-blue-500">
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Continue <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}