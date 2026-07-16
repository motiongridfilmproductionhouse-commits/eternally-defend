import { useQuery } from "@tanstack/react-query";
import { getProgress } from "@/lib/onboarding/progress.functions";
import { Link } from "@tanstack/react-router";
import { ShieldAlert, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function SensitiveAccessGate({ children }: { children: React.ReactNode }) {
  const { data: progress, isLoading } = useQuery({
    queryKey: ["onboarding_progress"],
    queryFn: () => getProgress(),
  });

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-white/50">
        <Loader2 className="size-6 animate-spin mr-3" />
        Authenticating Module...
      </div>
    );
  }

  // Access is only granted if onboarding is fully complete and active
  const isFullyOnboarded = progress?.overall_status === "COMPLETED";

  if (!isFullyOnboarded) {
    return (
      <div className="flex flex-col items-center justify-center p-8 h-[80vh]">
        <Card className="w-full max-w-md bg-[#0A1128] border-white/10 text-center shadow-2xl">
          <CardContent className="pt-10 pb-10 flex flex-col items-center">
            <div className="size-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
              <ShieldAlert className="size-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-3 tracking-tight">Restricted Module</h2>
            <p className="text-sm text-white/70 mb-8 max-w-[280px]">
              Complete verification and authorization to activate Intimate Image & Deepfake Protection.
            </p>
            <Link to="/onboarding">
              <Button className="bg-brand-glow hover:bg-brand-glow/90 text-white w-full max-w-[240px]">
                Complete Verification
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="bg-red-950/30 border border-red-500/20 text-red-200 text-xs px-4 py-2 flex items-center justify-center tracking-wide font-medium">
        RESTRICTED AND CONFIDENTIAL. AUTOMATED CLASSIFICATIONS ARE INDICATORS ONLY AND REQUIRE HUMAN CONFIRMATION.
      </div>
      {children}
    </div>
  );
}
