import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveV2ClientProfile } from "@/lib/onboarding/v2-profile.functions";
import {
  V2_ACCOUNT_LABELS,
  isRepresentativeAccount,
  type V2AccountType,
} from "@/lib/onboarding/v2-config";
import { VERIFICATION_OPTIONAL_MESSAGE } from "@/lib/verification/verification-status";

type ProfileLike = {
  legal_name?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  company_name?: string | null;
  role_title?: string | null;
  country?: string | null;
  website?: string | null;
  social_profiles?: unknown;
};

function publicProfileOf(profile: ProfileLike | null | undefined) {
  const raw = (profile?.social_profiles ?? {}) as {
    aliases?: unknown;
    handles?: unknown;
    photo_url?: unknown;
  };
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return {
    aliases: list(raw.aliases).join(", "),
    handles: list(raw.handles).join(", "),
    photo_url: typeof raw.photo_url === "string" ? raw.photo_url : "",
  };
}

/**
 * Public-profile setup for friction-light routes. Collects discovery details
 * only — no identity documents are requested here.
 */
export function LightProfileStep({
  profile,
  accountType,
  onSaved,
}: {
  profile: ProfileLike | null | undefined;
  accountType: V2AccountType;
  onSaved: () => Promise<void> | void;
}) {
  const save = useServerFn(saveV2ClientProfile);
  const [busy, setBusy] = useState(false);
  const representative = isRepresentativeAccount(accountType);

  const build = (p: ProfileLike | null | undefined) => {
    const pub = publicProfileOf(p);
    return {
      legal_name: p?.legal_name ?? p?.full_name ?? "",
      display_name: p?.display_name ?? "",
      company_name: p?.company_name ?? "",
      role_title: p?.role_title ?? "",
      country: p?.country ?? "",
      website: p?.website ?? "",
      aliases: pub.aliases,
      social_handles: pub.handles,
      profile_photo_url: pub.photo_url,
    };
  };

  const [form, setForm] = useState(() => build(profile));
  useEffect(() => {
    if (profile) setForm(build(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const valid = Boolean(form.legal_name.trim() && form.country.trim());

  const split = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await save({
        data: {
          legal_name: form.legal_name,
          display_name: form.display_name || null,
          company_name: form.company_name || null,
          role_title: form.role_title || null,
          country: form.country,
          website: form.website || null,
          aliases: split(form.aliases),
          social_handles: split(form.social_handles),
          profile_photo_url: form.profile_photo_url || null,
        },
      });
      await onSaved();
      toast.success("Profile saved.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to save profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">{V2_ACCOUNT_LABELS[accountType]} profile</CardTitle>
        <CardDescription className="text-white/60">
          {representative
            ? "Add the public figure or brand you represent so monitoring can begin."
            : "Add your public details so monitoring can find content about you."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-blue-400/25 bg-blue-500/10 p-4 text-xs leading-relaxed text-blue-100">
          <Info className="mt-0.5 size-4 shrink-0 text-blue-300" />
          <span>{VERIFICATION_OPTIONAL_MESSAGE}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={representative ? "Your name" : "Public name"} required>
            <Input
              value={form.legal_name}
              onChange={set("legal_name")}
              className="border-white/10 bg-[#0F172A] text-white"
            />
          </Field>
          <Field label={representative ? "Public figure / brand" : "Stage / professional name"}>
            <Input
              value={form.display_name}
              onChange={set("display_name")}
              className="border-white/10 bg-[#0F172A] text-white"
            />
          </Field>
          <Field label="Aliases (comma separated)">
            <Input
              value={form.aliases}
              onChange={set("aliases")}
              placeholder="Nickname, alternate spelling"
              className="border-white/10 bg-[#0F172A] text-white"
            />
          </Field>
          <Field label="Social handles (comma separated)">
            <Input
              value={form.social_handles}
              onChange={set("social_handles")}
              placeholder="@handle, youtube.com/@channel"
              className="border-white/10 bg-[#0F172A] text-white"
            />
          </Field>
          <Field label="Official website">
            <Input
              value={form.website}
              onChange={set("website")}
              placeholder="https://"
              className="border-white/10 bg-[#0F172A] text-white"
            />
          </Field>
          <Field label="Profession / industry">
            <Input
              value={form.role_title}
              onChange={set("role_title")}
              placeholder="Actor, musician, athlete…"
              className="border-white/10 bg-[#0F172A] text-white"
            />
          </Field>
          <Field label="Country" required>
            <Input
              value={form.country}
              onChange={set("country")}
              className="border-white/10 bg-[#0F172A] text-white"
            />
          </Field>
          <Field label="Public profile photo URL">
            <Input
              value={form.profile_photo_url}
              onChange={set("profile_photo_url")}
              placeholder="https://"
              className="border-white/10 bg-[#0F172A] text-white"
            />
          </Field>
          {representative && (
            <Field label="Organization / firm">
              <Input
                value={form.company_name}
                onChange={set("company_name")}
                className="border-white/10 bg-[#0F172A] text-white"
              />
            </Field>
          )}
        </div>

        <div className="flex justify-end border-t border-white/10 pt-4">
          <Button
            onClick={submit}
            disabled={!valid || busy}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Save & Continue{" "}
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
