import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Link2, CheckCircle2, Save } from "lucide-react";
import {
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type SocialProfileLink,
  getSocialProfileLinks,
  saveSocialProfileLinks,
} from "@/lib/onboarding/social-profiles.functions";

const LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X / Twitter",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
  other: "Other website / social profile",
};

const PLACEHOLDERS: Record<SocialPlatform, string> = {
  instagram: "https://instagram.com/username",
  facebook: "https://facebook.com/username",
  x: "https://x.com/username",
  tiktok: "https://tiktok.com/@username",
  youtube: "https://youtube.com/@channel",
  linkedin: "https://linkedin.com/in/username",
  threads: "https://threads.net/@username",
  other: "https://example.com/profile",
};

const BASE_PLATFORMS: SocialPlatform[] = [
  "instagram",
  "facebook",
  "x",
  "tiktok",
  "youtube",
  "linkedin",
  "threads",
];

type Row = { platform: SocialPlatform; url: string };

/**
 * Optional official public profile links. No OAuth, no login, no ownership
 * verification — these are stored purely as trusted reference URLs.
 */
export function SocialProfilesPanel({ compact = false }: { compact?: boolean }) {
  const fetchLinks = useServerFn(getSocialProfileLinks);
  const saveLinks = useServerFn(saveSocialProfileLinks);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["social_profile_links"],
    queryFn: () => fetchLinks(),
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    if (!data) return;
    const saved = data.links as SocialProfileLink[];
    setSavedCount(saved.length);
    const map = new Map(saved.map((l) => [l.platform, l.url] as const));
    const base: Row[] = BASE_PLATFORMS.map((p) => ({ platform: p, url: map.get(p) ?? "" }));
    const extras: Row[] = saved
      .filter((l) => !BASE_PLATFORMS.includes(l.platform))
      .map((l) => ({ platform: l.platform, url: l.url }));
    setRows([...base, ...extras]);
  }, [data]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleSave = async () => {
    const cleaned = rows
      .map((r) => ({ platform: r.platform, url: r.url.trim() }))
      .filter((r) => r.url.length > 0);
    const invalid = cleaned.find((r) => !/^https?:\/\/.+/i.test(r.url));
    if (invalid) {
      toast.error(`Enter a full URL starting with https:// for ${LABELS[invalid.platform]}.`);
      return;
    }
    setSaving(true);
    try {
      await saveLinks({ data: { links: cleaned } });
      await refetch();
      toast.success(
        cleaned.length ? `${cleaned.length} profile${cleaned.length > 1 ? "s" : ""} saved.` : "Profiles cleared.",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save profiles");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={
        compact
          ? "space-y-4"
          : "rounded-xl border border-white/10 bg-white/5 p-4 space-y-4"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white uppercase tracking-wider">
            Social Media Profiles (Optional)
          </div>
          <p className="text-xs text-white/50 mt-1 max-w-xl">
            Add your official public profiles so Eterna Sentinel can recognize and monitor your
            authentic presence. No login or ownership verification is required, and these are not
            needed to continue onboarding.
          </p>
        </div>
        {savedCount > 0 && (
          <Badge
            variant="outline"
            className="border-sky-500/30 bg-sky-500/10 text-sky-200 text-[10px] uppercase shrink-0"
          >
            {savedCount} profile{savedCount > 1 ? "s" : ""} added
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="py-6 flex justify-center">
          <Loader2 className="size-5 animate-spin text-sky-400" />
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => {
            const isExtra = i >= BASE_PLATFORMS.length;
            const saved = (data?.links ?? []).some(
              (l: SocialProfileLink) => l.platform === row.platform && l.url === row.url.trim(),
            );
            return (
              <div key={`${row.platform}-${i}`} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-white/60">
                    {isExtra ? (
                      <select
                        value={row.platform}
                        onChange={(e) =>
                          setRow(i, { platform: e.target.value as SocialPlatform })
                        }
                        className="bg-[#0F172A] border border-white/10 rounded-md px-2 py-1 text-xs text-white"
                      >
                        {SOCIAL_PLATFORMS.map((p) => (
                          <option key={p} value={p}>
                            {LABELS[p]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      LABELS[row.platform]
                    )}
                  </label>
                  {saved && row.url.trim() && (
                    <span className="text-[10px] text-emerald-300 flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Profile added
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="size-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={row.url}
                      onChange={(e) => setRow(i, { url: e.target.value })}
                      placeholder={PLACEHOLDERS[row.platform]}
                      className="bg-[#0F172A] border-white/10 text-white pl-8"
                      disabled={saving}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      isExtra
                        ? setRows((prev) => prev.filter((_, idx) => idx !== i))
                        : setRow(i, { url: "" })
                    }
                    disabled={saving}
                    className="size-9 shrink-0 text-white/40 hover:text-red-400 hover:bg-white/10"
                    title="Remove"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => setRows((prev) => [...prev, { platform: "other", url: "" }])}
              disabled={saving}
              className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
            >
              <Plus className="size-4 mr-1" /> Add another profile
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-500 text-white border-0"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              Save profiles
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
