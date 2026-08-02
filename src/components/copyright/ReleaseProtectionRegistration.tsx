import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  calculateProtectionReadiness,
  meetsAutomaticMonitoringReferenceMinimum,
  MONITORING_DISCLAIMER,
  type ReleaseProtectionSettings,
  type ReleaseType,
  validateReleaseProtectionSettings,
} from "@/lib/copyright/release-protection";

export interface ReleaseProtectionFormState {
  enabled: boolean;
  release_date: string;
  release_timezone: string;
  release_type: ReleaseType;
  release_countries: string;
  primary_language: string;
  alternate_titles: string;
  languages: string;
  studio: string;
  distributor: string;
  ott_platform: string;
  premiere_date: string;
  censor_date: string;
  press_screening_date: string;
  trailer_release_date: string;
  embargo_date: string;
  digital_release_date: string;
  home_video_release_date: string;
  alert_threshold: ReleaseProtectionSettings["alert_threshold"];
  cadence_profile: ReleaseProtectionSettings["cadence_profile"];
  custom_cadence_minutes: string;
}

export const defaultReleaseProtectionForm = (): ReleaseProtectionFormState => ({
  enabled: false,
  release_date: "",
  release_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  release_type: "theatrical",
  release_countries: "",
  primary_language: "",
  alternate_titles: "",
  languages: "",
  studio: "",
  distributor: "",
  ott_platform: "",
  premiere_date: "",
  censor_date: "",
  press_screening_date: "",
  trailer_release_date: "",
  embargo_date: "",
  digital_release_date: "",
  home_video_release_date: "",
  alert_threshold: "high_and_critical",
  cadence_profile: "default",
  custom_cadence_minutes: "180",
});

export function formToReleaseProtectionSettings(
  form: ReleaseProtectionFormState,
): ReleaseProtectionSettings {
  const countries = form.release_countries
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const languages = form.languages
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const alternateTitles = form.alternate_titles
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    enabled: form.enabled,
    release_date: form.release_date,
    release_timezone: form.release_timezone,
    release_type: form.release_type,
    release_countries: countries,
    languages: languages.length ? languages : [form.primary_language].filter(Boolean),
    primary_language: form.primary_language,
    alternate_titles: alternateTitles,
    studio: form.studio,
    distributor: form.distributor,
    ott_platform: form.ott_platform || undefined,
    premiere_date: form.premiere_date || undefined,
    censor_date: form.censor_date || undefined,
    press_screening_date: form.press_screening_date || undefined,
    trailer_release_date: form.trailer_release_date || undefined,
    embargo_date: form.embargo_date || undefined,
    digital_release_date: form.digital_release_date || undefined,
    home_video_release_date: form.home_video_release_date || undefined,
    alert_threshold: form.alert_threshold,
    cadence_profile: form.cadence_profile,
    custom_cadence_minutes:
      form.cadence_profile === "custom"
        ? Number.parseInt(form.custom_cadence_minutes, 10)
        : undefined,
  };
}

export interface ReleaseProtectionRegistrationProps {
  form: ReleaseProtectionFormState;
  onChange: (next: ReleaseProtectionFormState) => void;
  primaryPosterReady: boolean;
  additionalVisualCount: number;
  videoReferenceCount: number;
}

export function ReleaseProtectionRegistration({
  form,
  onChange,
  primaryPosterReady,
  additionalVisualCount,
  videoReferenceCount,
}: ReleaseProtectionRegistrationProps) {
  const settings = formToReleaseProtectionSettings(form);
  const validationErrors = form.enabled ? validateReleaseProtectionSettings(settings) : [];
  const readiness = useMemo(
    () =>
      calculateProtectionReadiness({
        settings,
        referencePackage: {
          primary_poster_key: primaryPosterReady ? "primary" : undefined,
          additional_visual_keys: Array.from({ length: additionalVisualCount }, (_, i) => `v${i}`),
          video_reference_keys: Array.from({ length: videoReferenceCount }, (_, i) => `vid${i}`),
        },
        metadataComplete: Boolean(form.studio && form.distributor),
      }),
    [settings, primaryPosterReady, additionalVisualCount, videoReferenceCount, form.studio, form.distributor],
  );

  const referenceOk = meetsAutomaticMonitoringReferenceMinimum({
    primary_poster_key: primaryPosterReady ? "primary" : undefined,
    additional_visual_keys: Array.from({ length: additionalVisualCount }, String),
    video_reference_keys: Array.from({ length: videoReferenceCount }, String),
  });

  return (
    <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.enabled}
          onChange={(e) => onChange({ ...form, enabled: e.target.checked })}
        />
        <span>
          <span className="font-medium">Enable automatic release protection</span>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Schedule public-source monitoring before and after release for leaked copies, censor
            prints, theatre prints, unauthorized uploads, and distribution pages. {MONITORING_DISCLAIMER}
          </p>
        </span>
      </label>

      {form.enabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Theatrical / release date *
            </label>
            <Input
              type="date"
              value={form.release_date}
              onChange={(e) => onChange({ ...form, release_date: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Release timezone *
            </label>
            <Input
              value={form.release_timezone}
              onChange={(e) => onChange({ ...form, release_timezone: e.target.value })}
              placeholder="Asia/Kolkata"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Release type *
            </label>
            <select
              className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
              value={form.release_type}
              onChange={(e) =>
                onChange({ ...form, release_type: e.target.value as ReleaseType })
              }
            >
              <option value="theatrical">Theatrical</option>
              <option value="festival">Festival</option>
              <option value="streaming">Streaming</option>
              <option value="television">Television</option>
              <option value="direct-to-video">Direct-to-video</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Release countries * (comma-separated)
            </label>
            <Input
              value={form.release_countries}
              onChange={(e) => onChange({ ...form, release_countries: e.target.value })}
              placeholder="IN, US"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Primary language *
            </label>
            <Input
              value={form.primary_language}
              onChange={(e) => onChange({ ...form, primary_language: e.target.value })}
              placeholder="ta"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Languages * (comma-separated)
            </label>
            <Input
              value={form.languages}
              onChange={(e) => onChange({ ...form, languages: e.target.value })}
              placeholder="ta, en"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Alternate titles (comma-separated)
            </label>
            <Input
              value={form.alternate_titles}
              onChange={(e) => onChange({ ...form, alternate_titles: e.target.value })}
              placeholder="Alternate spellings or transliterations"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Official studio / producer *
            </label>
            <Input
              value={form.studio}
              onChange={(e) => onChange({ ...form, studio: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Authorized distributor *
            </label>
            <Input
              value={form.distributor}
              onChange={(e) => onChange({ ...form, distributor: e.target.value })}
            />
          </div>
          {(form.release_type === "streaming" || form.ott_platform) && (
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Official OTT platform
              </label>
              <Input
                value={form.ott_platform}
                onChange={(e) => onChange({ ...form, ott_platform: e.target.value })}
                placeholder="Netflix, Prime Video, etc."
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Alert threshold
            </label>
            <select
              className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
              value={form.alert_threshold}
              onChange={(e) =>
                onChange({
                  ...form,
                  alert_threshold: e.target.value as ReleaseProtectionFormState["alert_threshold"],
                })
              }
            >
              <option value="critical_only">Critical only</option>
              <option value="high_and_critical">High and Critical</option>
              <option value="all_verified">All verified findings</option>
              <option value="daily_summary">Daily summary only</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Monitoring cadence
            </label>
            <select
              className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
              value={form.cadence_profile}
              onChange={(e) =>
                onChange({
                  ...form,
                  cadence_profile: e.target.value as ReleaseProtectionFormState["cadence_profile"],
                })
              }
            >
              <option value="default">Default (release-aware)</option>
              <option value="custom">Custom interval</option>
            </select>
          </div>
          {form.cadence_profile === "custom" && (
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Custom interval (minutes, 60–1440)
              </label>
              <Input
                type="number"
                min={60}
                max={1440}
                value={form.custom_cadence_minutes}
                onChange={(e) => onChange({ ...form, custom_cadence_minutes: e.target.value })}
              />
            </div>
          )}

          <div className="rounded-md border border-border/40 bg-background/40 p-2 sm:col-span-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Protection readiness
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{readiness.level.replace(/_/g, " ")}</Badge>
              <span className="text-sm font-semibold tabular-nums">{readiness.score}%</span>
              {!referenceOk && (
                <span className="text-[11px] text-amber-300">
                  Requires 1 poster + 2 additional visuals + 1 trailer/video reference
                </span>
              )}
            </div>
            <ul className="mt-2 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
              {readiness.checklist.map((item) => (
                <li key={item.label}>
                  {item.label}: {item.status}
                </li>
              ))}
            </ul>
          </div>

          {validationErrors.length > 0 && (
            <ul className="space-y-1 text-[11px] text-destructive sm:col-span-2">
              {validationErrors.map((err) => (
                <li key={err}>• {err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
