import { AssetVerificationStep } from "@/components/onboarding/AssetVerificationStep";
import { SocialProfilesPanel } from "@/components/onboarding/SocialProfilesPanel";

export function CompanyAssetsStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <SocialProfilesPanel />
      <AssetVerificationStep onBack={onBack} onNext={onNext} />
    </div>
  );
}
