import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Link2, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCompanyOnboarding,
  saveCompanyOfficialProfiles,
} from "@/lib/onboarding/company.functions";
import {
  COMPANY_SOCIAL_LABELS,
  COMPANY_SOCIAL_PLACEHOLDERS,
  COMPANY_SOCIAL_PLATFORMS,
  normalizeProfileUrl,
  type CompanySocialPlatform,
} from "@/lib/onboarding/company-official-profiles";

const INPUT = "border-white/10 bg-[#0F172A] text-white";
const GHOST_BUTTON =
  "border border-sky-500/30 bg-slate-950/60 text-sky-100 hover:bg-slate-900/80 hover:text-white";

const BASE_PLATFORMS: CompanySocialPlatform[] = [
  "linkedin",
  "instagram",
  "facebook",
  "x",
  "youtube",
  "tiktok",
];

type Row = { platform: CompanySocialPlatform; url: string };

/**
 * Official company social profiles. Self-declared links only — no OAuth and no
 * ownership check — stored as trusted references for monitoring.
 */
export function CompanySocialStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const fetchCompany = useServerFn(getCompanyOnboarding);
  const save = useServerFn(saveCompanyOfficialProfiles);
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["company-onboarding"],
    queryFn: () => fetchCompany(),
  });

  const [rows, setRows] = useState<Row[]>(
    BASE_PLATFORMS.map((platform) => ({ platform, url: "" })),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = data?.official_profiles;
    if (!saved) return;
    const next: Row[] = BASE_PLATFORMS.map((platform) => ({
      platform,
      url: saved.find((link) => link.platform === platform)?.url ?? "",
    }));
    for (const link of saved) {
      if (!BASE_PLATFORMS.includes(link.platform)) {
        next.push({ platform: link.platform, url: link.url });
      }
    }
    setRows(next);
  }, [data?.official_profiles]);

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const filled = rows.filter((row) => normalizeProfileUrl(row.url));
  const invalid = rows.some((row) => row.url.trim() && !normalizeProfileUrl(row.url));

  const persist = async () => {
    setBusy(true);
    try {
      const result = await save({
        data: { profiles: rows.map((row) => ({ platform: row.platform, url: row.url })) },
      });
      await refetch();
      toast.success(
        result?.profiles.length
          ? `${result.profiles.length} official profile${result.profiles.length === 1 ? "" : "s"} saved.`
          : "Official profiles saved.",
      );
      onNext();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save official profiles");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Official Company Social Profiles</CardTitle>
        <CardDescription className="text-white/60">
          Add the company&apos;s official public profiles. These are stored as trusted references so
          monitoring can tell your real accounts apart from impersonating ones.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-2 rounded-lg border border-sky-400/20 bg-sky-500/10 p-3 text-[11px] leading-relaxed text-sky-100">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No login or ownership proof is requested. Links are marked official / self-declared —
            never &quot;verified&quot; — and used only as a trusted allow-list for impersonation
            detection.
          </span>
        </div>

        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div
                key={`${row.platform}-${index}`}
                className="grid gap-2 sm:grid-cols-[180px_1fr_auto]"
              >
                <div className="space-y-1.5">
                  {index === 0 && <Label className="text-xs text-white/75">Platform</Label>}
                  <select
                    value={row.platform}
                    onChange={(event) =>
                      setRow(index, { platform: event.target.value as CompanySocialPlatform })
                    }
                    className="h-10 w-full rounded-md border border-white/10 bg-[#0F172A] px-3 text-sm text-white"
                  >
                    {COMPANY_SOCIAL_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {COMPANY_SOCIAL_LABELS[platform]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  {index === 0 && <Label className="text-xs text-white/75">Profile URL</Label>}
                  <Input
                    value={row.url}
                    onChange={(event) => setRow(index, { url: event.target.value })}
                    placeholder={COMPANY_SOCIAL_PLACEHOLDERS[row.platform]}
                    className={INPUT}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    className="text-white/50 hover:bg-white/10 hover:text-white"
                    aria-label="Remove profile"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              onClick={() => setRows((current) => [...current, { platform: "other", url: "" }])}
              className={GHOST_BUTTON}
            >
              <Plus className="mr-2 size-4" /> Add another official profile
            </Button>

            <div className="flex items-center gap-2 text-xs text-white/50">
              <Link2 className="size-3.5" />
              {filled.length} profile{filled.length === 1 ? "" : "s"} ready to save
              {invalid && <span className="text-amber-300">· some links are not valid URLs</span>}
            </div>
          </div>
        )}

        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button
            onClick={persist}
            disabled={busy}
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
