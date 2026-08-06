import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getV2Evidence, submitV2Evidence } from "@/lib/onboarding/v2-evidence.functions";
import type { V2AccountType } from "@/lib/onboarding/v2-config";

export function V2RepresentativeStep({
  accountType,
  onBack,
  onNext,
}: {
  accountType: Extract<V2AccountType, "enterprise" | "production_house">;
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchEvidence = useServerFn(getV2Evidence);
  const submitEvidence = useServerFn(submitV2Evidence);
  const {
    data: evidence = [],
    refetch,
    isLoading,
  } = useQuery({
    queryKey: ["onboarding-v2-evidence"],
    queryFn: () => fetchEvidence(),
  });
  const existing = evidence.find((item) => item.evidence_type === "representative");
  const meta = (existing?.metadata ?? {}) as {
    representative_name?: string | null;
    representative_title?: string | null;
    representative_email?: string | null;
    representative_phone?: string | null;
  };
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    representative_name: "",
    representative_title: "",
    representative_email: "",
    representative_phone: "",
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      representative_name: meta.representative_name ?? existing.reference_value ?? "",
      representative_title: meta.representative_title ?? "",
      representative_email: meta.representative_email ?? "",
      representative_phone: meta.representative_phone ?? "",
    });
  }, [existing]);

  const valid = form.representative_name.trim().length > 1;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await submitEvidence({
        data: {
          evidence_type: "representative",
          representative_name: form.representative_name,
          representative_title: form.representative_title || null,
          representative_email: form.representative_email || null,
          representative_phone: form.representative_phone || null,
        },
      });
      await refetch();
      toast.success("Representative details saved.");
      onNext();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save representative");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Representative Details</CardTitle>
        <CardDescription className="text-white/60">
          {accountType === "production_house"
            ? "Identify the authorized rights representative for this production house."
            : "Identify the authorized company representative for this organization."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Representative full name" required>
              <Input
                value={form.representative_name}
                onChange={(e) => setForm({ ...form, representative_name: e.target.value })}
                className="border-white/10 bg-[#0F172A] text-white"
              />
            </Field>
            <Field label="Role / title">
              <Input
                value={form.representative_title}
                onChange={(e) => setForm({ ...form, representative_title: e.target.value })}
                className="border-white/10 bg-[#0F172A] text-white"
              />
            </Field>
            <Field label="Work email">
              <Input
                type="email"
                value={form.representative_email}
                onChange={(e) => setForm({ ...form, representative_email: e.target.value })}
                className="border-white/10 bg-[#0F172A] text-white"
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.representative_phone}
                onChange={(e) => setForm({ ...form, representative_phone: e.target.value })}
                className="border-white/10 bg-[#0F172A] text-white"
              />
            </Field>
          </div>
        )}
        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button
            onClick={existing ? onNext : submit}
            disabled={!valid || busy}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {existing ? "Continue" : "Save & Continue"}
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-white/75">
        {label}
        {required && <span className="text-blue-300"> *</span>}
      </Label>
      {children}
    </div>
  );
}
