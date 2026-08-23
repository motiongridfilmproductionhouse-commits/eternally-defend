import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PageCard } from "@/components/dashboard/PageCard";
import { Switch } from "@/components/ui/switch";
import { SocialProfilesPanel } from "@/components/onboarding/SocialProfilesPanel";
import { SocialAssetProtectionPanel } from "@/components/social/SocialAssetProtectionPanel";
import { SignedAuthorizationCard } from "@/components/profile/SignedAuthorizationCard";

import { useSession } from "@/hooks/use-session";
import {
  getAccountProfile,
  updateAccountProfile,
} from "@/lib/profile/account-profile.functions";
import {
  NOT_PROVIDED,
  buildSettingsProfileView,
} from "@/lib/profile/settings-profile";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — Eterna Sentinel" }] }),
  component: SettingsPage,
});

const INPUT_CLASS =
  "mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm bg-background";

function SettingsPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id ?? null;
  const fetchProfile = useServerFn(getAccountProfile);
  const saveProfile = useServerFn(updateAccountProfile);

  // Keyed by the authenticated user id so a different account never reads
  // another account's cached profile after logout/login.
  const profileQuery = useQuery({
    queryKey: ["account-profile", userId ?? "anon"],
    queryFn: () => fetchProfile(),
    enabled: ready && !!userId,
  });

  const view = buildSettingsProfileView(
    profileQuery.data?.profile ?? null,
    profileQuery.data?.email ?? session?.user.email ?? null,
  );

  const [form, setForm] = useState({
    legal_name: "",
    display_name: "",
    phone: "",
    country: "",
    company_name: "",
    role_title: "",
  });
  const [saving, setSaving] = useState(false);

  // Re-hydrate whenever the authenticated user or their persisted row changes.
  useEffect(() => {
    setForm({
      legal_name: view.legalName,
      display_name: view.displayName,
      phone: view.phone,
      country: view.country,
      company_name: view.companyName,
      role_title: view.roleTitle,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profileQuery.data?.profile]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async () => {
    setSaving(true);
    try {
      await saveProfile({
        data: {
          legal_name: form.legal_name,
          display_name: form.display_name || null,
          phone: form.phone || null,
          country: form.country || null,
          company_name: view.showsOrganizationFields ? form.company_name || null : null,
          role_title: view.showsOrganizationFields ? form.role_title || null : null,
        },
      });
      await profileQuery.refetch();
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update profile");
    } finally {
      setSaving(false);
    }
  };

  const [prefs, setPrefs] = useState({
    autoTakedown: true,
    weeklyDigest: true,
    smsAlerts: false,
    deepfakeAlerts: true,
    aiSuggestions: true,
    legalEscalation: false,
  });

  const loading = !ready || profileQuery.isLoading;

  return (
    <div className="space-y-5 max-w-3xl">
      <PageCard title="ACCOUNT" sub="Your profile as saved during onboarding">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your profile…
          </div>
        ) : view.isEmpty ? (
          <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            <div className="font-semibold text-foreground">No profile saved yet</div>
            <p className="mt-1">
              Complete onboarding to create your protection profile. Nothing is shown here until
              your own details are saved.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-xs font-semibold">
                Full name
                <input value={form.legal_name} onChange={set("legal_name")} className={INPUT_CLASS} />
              </label>
              <label className="text-xs font-semibold">
                Display name
                <input
                  value={form.display_name}
                  onChange={set("display_name")}
                  placeholder={NOT_PROVIDED}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="text-xs font-semibold">
                Email
                <input
                  value={view.email}
                  readOnly
                  placeholder={NOT_PROVIDED}
                  className={`${INPUT_CLASS} text-muted-foreground`}
                />
              </label>
              <label className="text-xs font-semibold">
                Phone
                <input
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder={NOT_PROVIDED}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="text-xs font-semibold">
                Country
                <input
                  value={form.country}
                  onChange={set("country")}
                  placeholder={NOT_PROVIDED}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="text-xs font-semibold">
                Account type
                <input
                  value={(view.accountType || view.clientType).replace(/_/g, " ")}
                  readOnly
                  placeholder={NOT_PROVIDED}
                  className={`${INPUT_CLASS} text-muted-foreground capitalize`}
                />
              </label>

              {view.showsOrganizationFields && (
                <>
                  <label className="text-xs font-semibold">
                    Organization
                    <input
                      value={form.company_name}
                      onChange={set("company_name")}
                      placeholder={NOT_PROVIDED}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    Role
                    <input
                      value={form.role_title}
                      onChange={set("role_title")}
                      placeholder={NOT_PROVIDED}
                      className={INPUT_CLASS}
                    />
                  </label>
                </>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                Client ID: {view.clientId || NOT_PROVIDED}
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={saving || !form.legal_name.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-border disabled:opacity-50"
                style={{ background: "var(--gradient-soft)" }}
              >
                {saving && <Loader2 className="size-4 animate-spin" />} Save changes
              </button>
            </div>
          </>
        )}
      </PageCard>

      <PageCard
        title="OFFICIAL PROFILES"
        sub="Public social profile links used as trusted references"
      >
        <div className="rounded-xl bg-[#0A1128] p-4">
          <SocialProfilesPanel compact />
          <SocialAssetProtectionPanel compact />
        </div>
      </PageCard>

      <SignedAuthorizationCard />

      <PageCard title="PLAN" sub="Elite Protection">

        <div
          className="rounded-xl p-4 flex items-center gap-4"
          style={{ background: "var(--gradient-soft)" }}
        >
          <div
            className="size-12 rounded-2xl grid place-items-center text-white"
            style={{ background: "var(--gradient-brand)" }}
          >
            ★
          </div>
          <div className="flex-1">
            <div className="font-semibold">Elite Protection</div>
            <div className="text-xs text-muted-foreground">
              Unlimited monitoring, DMCA automation, deepfake AI, legal escalation.
            </div>
          </div>
          <button className="px-4 py-2 rounded-lg bg-white text-sm font-semibold border border-border">
            Manage
          </button>
        </div>
      </PageCard>

      <PageCard title="PREFERENCES" sub="Automation and alerts">
        <div className="space-y-3">
          {Object.entries(prefs).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm font-semibold capitalize">
                  {k.replace(/([A-Z])/g, " $1")}
                </div>
                <div className="text-xs text-muted-foreground">
                  Toggle {k.replace(/([A-Z])/g, " $1").toLowerCase()}.
                </div>
              </div>
              <Switch checked={v} onCheckedChange={(nv) => setPrefs((p) => ({ ...p, [k]: nv }))} />
            </div>
          ))}
        </div>
      </PageCard>
    </div>
  );
}
