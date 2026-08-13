import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Loader2, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCompanyOnboarding,
  saveCompanyProtectionServices,
} from "@/lib/onboarding/company.functions";
import {
  COMPANY_PROTECTION_SERVICES,
  availableCompanyServices,
} from "@/lib/onboarding/company-config";

export function CompanyServicesStep({
  faceEnrolled,
  onBack,
  onNext,
}: {
  faceEnrolled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchCompany = useServerFn(getCompanyOnboarding);
  const save = useServerFn(saveCompanyProtectionServices);
  const { data, isLoading } = useQuery({
    queryKey: ["company-onboarding"],
    queryFn: () => fetchCompany(),
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.services?.length) setSelected(data.services);
  }, [data?.services]);

  const available = availableCompanyServices(faceEnrolled);
  const gated = COMPANY_PROTECTION_SERVICES.filter(
    (service) => service.requiresFaceEnrollment && !faceEnrolled,
  );

  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );

  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: { services: selected } });
      toast.success("Protection services saved.");
      onNext();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save services");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Protection Services</CardTitle>
        <CardDescription className="text-white/60">
          Choose what Eterna is authorized to monitor and prepare for this company.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((service) => {
              const active = selected.includes(service.key);
              return (
                <button
                  key={service.key}
                  type="button"
                  onClick={() => toggle(service.key)}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left text-sm transition ${
                    active
                      ? "border-blue-400 bg-blue-500/15 text-white"
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                >
                  <span>{service.label}</span>
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded border ${
                      active ? "border-blue-300 bg-blue-500 text-white" : "border-white/25"
                    }`}
                  >
                    {active && <Check className="size-3.5" />}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {gated.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-white/60">
            <ScanFace className="mt-0.5 size-4 shrink-0 text-sky-300" />
            <span>
              {gated.map((service) => service.label).join(", ")} becomes available once an
              authorized person completes Face Protection enrollment.
            </span>
          </div>
        )}

        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button
            onClick={submit}
            disabled={busy || selected.length === 0}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Save &amp; Continue
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
