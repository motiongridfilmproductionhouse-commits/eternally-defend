import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Circle, Globe, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  calculateProtectionReadiness,
  computeMonitoringWindow,
  meetsAutomaticMonitoringReferenceMinimum,
  MONITORING_DISCLAIMER,
  type ReleaseProtectionSettings,
  type ReleaseType,
  validateReleaseProtectionSettings,
} from "@/lib/copyright/release-protection";
import type { ReleaseProtectionFormState } from "@/components/copyright/ReleaseProtectionRegistration";
import { formToReleaseProtectionSettings } from "@/components/copyright/ReleaseProtectionRegistration";

const TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Australia/Sydney",
];

const COUNTRY_OPTIONS = [
  { code: "IN", label: "India" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "AE", label: "UAE" },
  { code: "SG", label: "Singapore" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "JP", label: "Japan" },
];

const LANGUAGE_OPTIONS = [
  { code: "ta", label: "Tamil" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "te", label: "Telugu" },
  { code: "ml", label: "Malayalam" },
  { code: "kn", label: "Kannada" },
  { code: "mr", label: "Marathi" },
  { code: "bn", label: "Bengali" },
  { code: "ar", label: "Arabic" },
  { code: "ja", label: "Japanese" },
];

function parseCsv(value: string): string[] {
  return value
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinCsv(values: string[]): string {
  return values.join(", ");
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-xs font-medium text-foreground/90">
      {children}
      {required ? <span className="text-destructive"> *</span> : null}
    </label>
  );
}

const fieldClass =
  "h-11 w-full rounded-lg border border-border/70 bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary/30";

export function ChipMultiSelect({
  label,
  options,
  selected,
  onChange,
  required,
  allowCustom,
}: {
  label: string;
  options: Array<{ code: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  required?: boolean;
  allowCustom?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const toggle = (code: string) => {
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  };
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <div className="flex min-h-11 flex-wrap gap-1.5 rounded-lg border border-border/70 bg-background p-2">
        {options.map((opt) => {
          const active = selected.includes(opt.code);
          return (
            <button
              key={opt.code}
              type="button"
              onClick={() => toggle(opt.code)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 bg-muted/30 text-muted-foreground hover:border-primary/40",
              )}
            >
              {opt.label}
            </button>
          );
        })}
        {allowCustom && (
          <div className="flex items-center gap-1">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value.toUpperCase())}
              placeholder="Add"
              className="h-7 w-16 border-0 bg-transparent px-1 text-xs shadow-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  e.preventDefault();
                  if (!selected.includes(custom.trim())) onChange([...selected, custom.trim()]);
                  setCustom("");
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <FieldLabel required>Release timezone</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(fieldClass, "justify-between font-normal")}
          >
            <span className="truncate">{value || "Select timezone"}</span>
            <Globe className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search timezone…" />
            <CommandList>
              <CommandEmpty>No timezone found.</CommandEmpty>
              <CommandGroup>
                {TIMEZONES.map((tz) => (
                  <CommandItem
                    key={tz}
                    value={tz}
                    onSelect={() => {
                      onChange(tz);
                      setOpen(false);
                    }}
                  >
                    {tz}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function PolicyCard({
  title,
  description,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3 text-left transition",
        selected
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
          : "border-border/60 bg-background hover:border-primary/30",
      )}
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </button>
  );
}

export function useReleaseProtectionReadiness(input: {
  form: ReleaseProtectionFormState;
  primaryPosterReady: boolean;
  additionalVisualCount: number;
  videoReferenceCount: number;
}) {
  const settings = formToReleaseProtectionSettings(input.form);
  const validationErrors = input.form.enabled ? validateReleaseProtectionSettings(settings) : [];
  const readiness = useMemo(
    () =>
      calculateProtectionReadiness({
        settings,
        referencePackage: {
          primary_poster_key: input.primaryPosterReady ? "primary" : undefined,
          additional_visual_keys: Array.from(
            { length: input.additionalVisualCount },
            (_, i) => `v${i}`,
          ),
          video_reference_keys: Array.from(
            { length: input.videoReferenceCount },
            (_, i) => `vid${i}`,
          ),
        },
        metadataComplete: Boolean(input.form.studio && input.form.distributor),
      }),
    [
      settings,
      input.primaryPosterReady,
      input.additionalVisualCount,
      input.videoReferenceCount,
      input.form.studio,
      input.form.distributor,
    ],
  );

  const referenceOk = meetsAutomaticMonitoringReferenceMinimum({
    primary_poster_key: input.primaryPosterReady ? "primary" : undefined,
    additional_visual_keys: Array.from({ length: input.additionalVisualCount }, String),
    video_reference_keys: Array.from({ length: input.videoReferenceCount }, String),
  });

  const canActivate =
    input.form.enabled &&
    referenceOk &&
    (readiness.level === "strong" || readiness.level === "high_confidence") &&
    validationErrors.length === 0;

  const missing: string[] = [];
  if (!input.primaryPosterReady) missing.push("primary poster");
  const visualsNeeded = Math.max(0, 2 - input.additionalVisualCount);
  if (visualsNeeded > 0)
    missing.push(`${visualsNeeded} more visual reference${visualsNeeded > 1 ? "s" : ""}`);
  if (input.videoReferenceCount < 1) missing.push("trailer or video reference");
  if (input.form.enabled && !input.form.release_date) missing.push("release date");
  if (input.form.enabled && !input.form.release_timezone) missing.push("release timezone");
  if (input.form.enabled && parseCsv(input.form.release_countries).length === 0) {
    missing.push("release countries");
  }
  if (input.form.enabled && !input.form.studio) missing.push("studio/producer");
  if (input.form.enabled && !input.form.distributor) missing.push("distributor");

  return {
    settings,
    validationErrors,
    readiness,
    referenceOk,
    canActivate,
    missing,
  };
}

export function ProtectionReadinessPanel({
  form,
  primaryPosterReady,
  additionalVisualCount,
  videoReferenceCount,
}: {
  form: ReleaseProtectionFormState;
  primaryPosterReady: boolean;
  additionalVisualCount: number;
  videoReferenceCount: number;
}) {
  const { readiness, missing, referenceOk } = useReleaseProtectionReadiness({
    form,
    primaryPosterReady,
    additionalVisualCount,
    videoReferenceCount,
  });

  const checklist = [
    {
      label: "Title metadata",
      status: form.release_date && form.primary_language ? "complete" : "incomplete",
    },
    {
      label: "Release date",
      status: form.release_date && form.release_timezone ? "complete" : "incomplete",
    },
    {
      label: "Primary poster",
      status: primaryPosterReady ? "complete" : "incomplete",
    },
    {
      label: "Additional visuals",
      status:
        additionalVisualCount >= 2
          ? "complete"
          : additionalVisualCount >= 1
            ? "partial"
            : "incomplete",
    },
    {
      label: "Trailer/video reference",
      status: videoReferenceCount >= 1 ? "complete" : "incomplete",
    },
    {
      label: "Cast context",
      status: form.studio && form.distributor ? "complete" : "partial",
    },
    ...readiness.checklist.filter((c) => ["Visual diversity"].includes(c.label)),
  ];

  const statusIcon = (status: string) => {
    if (status === "complete") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    if (status === "partial") return <MinusCircle className="h-4 w-4 text-amber-500" />;
    return <Circle className="h-4 w-4 text-muted-foreground/50" />;
  };

  const levelLabel = readiness.level.replace(/_/g, " ");

  return (
    <div className="flex h-full flex-col rounded-xl border border-border/60 bg-gradient-to-b from-slate-50/80 to-white p-4 dark:from-slate-900/40 dark:to-card">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Protection Readiness
        </p>
        <div className="mt-3 flex items-center gap-4">
          <div
            className="relative grid h-20 w-20 place-items-center rounded-full border-4 border-primary/20 bg-background"
            style={{
              background: `conic-gradient(hsl(var(--primary)) ${readiness.score}%, hsl(var(--muted)) 0)`,
            }}
          >
            <div className="grid h-14 w-14 place-items-center rounded-full bg-background text-sm font-bold tabular-nums">
              {readiness.score}%
            </div>
          </div>
          <div>
            <Badge variant="outline" className="capitalize">
              {levelLabel}
            </Badge>
            <p className="mt-1 text-xs text-muted-foreground">
              {referenceOk ? "Reference package meets minimum." : "More references required."}
            </p>
          </div>
        </div>
      </div>

      <ul className="flex-1 space-y-2 overflow-y-auto">
        {checklist.map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/80 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              {statusIcon(item.status)}
              <span className="text-sm">{item.label}</span>
            </div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {item.status}
            </span>
          </li>
        ))}
      </ul>

      {missing.length > 0 && form.enabled && (
        <div className="mt-4 flex gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-100">
            To activate automatic protection, add {missing.join(", ")}.
          </p>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        {MONITORING_DISCLAIMER}
      </p>
    </div>
  );
}

export function ReleaseProtectionCenterForm({
  form,
  onChange,
  cadencePreset,
  onCadencePresetChange,
  coverageMode,
  onCoverageModeChange,
}: {
  form: ReleaseProtectionFormState;
  onChange: (next: ReleaseProtectionFormState) => void;
  cadencePreset: "recommended" | "aggressive" | "custom";
  onCadencePresetChange: (v: "recommended" | "aggressive" | "custom") => void;
  coverageMode: "standard" | "known" | "full";
  onCoverageModeChange: (v: "standard" | "known" | "full") => void;
}) {
  const countries = parseCsv(form.release_countries);
  const languages = parseCsv(form.languages);
  const monitoringWindow = form.release_date ? computeMonitoringWindow(form.release_date) : null;

  return (
    <div className="space-y-5">
      {/* Section A — Monitoring status */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-white p-4 shadow-sm dark:bg-card">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Automatic Release Protection</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Continuously scan configured public sources before and after release.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge variant={form.enabled ? "default" : "secondary"}>
            {form.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            onClick={() => onChange({ ...form, enabled: !form.enabled })}
            className={cn(
              "relative h-7 w-12 rounded-full transition",
              form.enabled ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition",
                form.enabled ? "left-5" : "left-0.5",
              )}
            />
          </button>
        </div>
      </div>

      {form.enabled && (
        <>
          {/* Section B — Release details */}
          <div className="rounded-xl border border-border/60 bg-white p-4 shadow-sm dark:bg-card">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Release details
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel required>Release date</FieldLabel>
                <Input
                  type="date"
                  className={fieldClass}
                  value={form.release_date}
                  onChange={(e) => onChange({ ...form, release_date: e.target.value })}
                />
              </div>
              <TimezoneSelect
                value={form.release_timezone}
                onChange={(tz) => onChange({ ...form, release_timezone: tz })}
              />
              <div>
                <FieldLabel required>Release type</FieldLabel>
                <select
                  className={fieldClass}
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
              <ChipMultiSelect
                label="Release countries"
                required
                options={COUNTRY_OPTIONS}
                selected={countries}
                onChange={(next) => onChange({ ...form, release_countries: joinCsv(next) })}
                allowCustom
              />
              <div>
                <FieldLabel required>Primary language</FieldLabel>
                <select
                  className={fieldClass}
                  value={form.primary_language}
                  onChange={(e) => onChange({ ...form, primary_language: e.target.value })}
                >
                  <option value="">Select language</option>
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.code})
                    </option>
                  ))}
                </select>
              </div>
              <ChipMultiSelect
                label="Additional languages"
                options={LANGUAGE_OPTIONS}
                selected={languages}
                onChange={(next) => onChange({ ...form, languages: joinCsv(next) })}
              />
              <div>
                <FieldLabel required>Studio / Producer</FieldLabel>
                <Input
                  className={fieldClass}
                  value={form.studio}
                  onChange={(e) => onChange({ ...form, studio: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel required>Authorized distributor</FieldLabel>
                <Input
                  className={fieldClass}
                  value={form.distributor}
                  onChange={(e) => onChange({ ...form, distributor: e.target.value })}
                />
              </div>
              {(form.release_type === "streaming" || form.ott_platform) && (
                <div className="sm:col-span-2">
                  <FieldLabel>Official OTT platform</FieldLabel>
                  <Input
                    className={fieldClass}
                    value={form.ott_platform}
                    onChange={(e) => onChange({ ...form, ott_platform: e.target.value })}
                    placeholder="Netflix, Prime Video, etc."
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <FieldLabel>Alternate titles and transliterations</FieldLabel>
                <Input
                  className={fieldClass}
                  value={form.alternate_titles}
                  onChange={(e) => onChange({ ...form, alternate_titles: e.target.value })}
                  placeholder="Separate multiple titles with commas"
                />
              </div>
            </div>
          </div>

          {/* Section C — Monitoring policy */}
          <div className="rounded-xl border border-border/60 bg-white p-4 shadow-sm dark:bg-card">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Monitoring policy
            </p>
            <div className="space-y-4">
              <div>
                <FieldLabel>Alert threshold</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-3">
                  <PolicyCard
                    title="Critical only"
                    description="Immediate alerts for confirmed pre-release leaks and verified distribution."
                    selected={form.alert_threshold === "critical_only"}
                    onClick={() => onChange({ ...form, alert_threshold: "critical_only" })}
                  />
                  <PolicyCard
                    title="High + Critical"
                    description="Recommended balance for release-week monitoring."
                    selected={form.alert_threshold === "high_and_critical"}
                    onClick={() => onChange({ ...form, alert_threshold: "high_and_critical" })}
                  />
                  <PolicyCard
                    title="All verified"
                    description="Includes medium-confidence review-worthy findings."
                    selected={form.alert_threshold === "all_verified"}
                    onClick={() => onChange({ ...form, alert_threshold: "all_verified" })}
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Monitoring cadence</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-3">
                  <PolicyCard
                    title="Recommended"
                    description="Release-aware schedule from daily to hourly near release."
                    selected={cadencePreset === "recommended"}
                    onClick={() => {
                      onCadencePresetChange("recommended");
                      onChange({ ...form, cadence_profile: "default" });
                    }}
                  />
                  <PolicyCard
                    title="Aggressive release week"
                    description="Uses the same release-aware cadence with tighter release-week focus."
                    selected={cadencePreset === "aggressive"}
                    onClick={() => {
                      onCadencePresetChange("aggressive");
                      onChange({ ...form, cadence_profile: "default" });
                    }}
                  />
                  <PolicyCard
                    title="Custom"
                    description="Set a fixed interval between 60 and 1440 minutes."
                    selected={cadencePreset === "custom"}
                    onClick={() => {
                      onCadencePresetChange("custom");
                      onChange({ ...form, cadence_profile: "custom" });
                    }}
                  />
                </div>
                {form.cadence_profile === "custom" && (
                  <div className="mt-3">
                    <FieldLabel>Custom interval (minutes)</FieldLabel>
                    <Input
                      type="number"
                      min={60}
                      max={1440}
                      className={cn(fieldClass, "max-w-xs")}
                      value={form.custom_cadence_minutes}
                      onChange={(e) =>
                        onChange({ ...form, custom_cadence_minutes: e.target.value })
                      }
                    />
                  </div>
                )}
              </div>
              <div>
                <FieldLabel>Coverage mode</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-3">
                  <PolicyCard
                    title="Web + Public Video"
                    description="Public web pages and public video sources."
                    selected={coverageMode === "standard"}
                    onClick={() => onCoverageModeChange("standard")}
                  />
                  <PolicyCard
                    title="Web + Public Video + submitted URLs"
                    description="Includes user-supplied known URL seeds in the scan."
                    selected={coverageMode === "known"}
                    onClick={() => onCoverageModeChange("known")}
                  />
                  <PolicyCard
                    title="Full configured coverage"
                    description="All configured public discovery channels for this workspace."
                    selected={coverageMode === "full"}
                    onClick={() => onCoverageModeChange("full")}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Display preference only — scans use configured public discovery channels.{" "}
                  {MONITORING_DISCLAIMER}
                </p>
              </div>
            </div>
          </div>

          {/* Section D — Advanced dates */}
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-white px-4 py-3 text-sm font-medium shadow-sm dark:bg-card">
              Advanced release milestones
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 rounded-xl border border-border/60 bg-white p-4 dark:bg-card">
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["premiere_date", "Premiere date"],
                    ["censor_date", "Censor certification date"],
                    ["press_screening_date", "Press screening date"],
                    ["trailer_release_date", "Trailer release date"],
                    ["embargo_date", "Embargo date"],
                    ["digital_release_date", "Expected digital release"],
                    ["home_video_release_date", "Expected home video release"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <FieldLabel>{label}</FieldLabel>
                    <Input
                      type="date"
                      className={fieldClass}
                      value={form[key]}
                      onChange={(e) => onChange({ ...form, [key]: e.target.value })}
                    />
                  </div>
                ))}
                {monitoringWindow && (
                  <>
                    <div>
                      <FieldLabel>Monitoring start (computed)</FieldLabel>
                      <Input
                        readOnly
                        className={cn(fieldClass, "bg-muted/40")}
                        value={new Date(monitoringWindow.monitoring_start_at).toLocaleDateString()}
                      />
                    </div>
                    <div>
                      <FieldLabel>Monitoring end (computed)</FieldLabel>
                      <Input
                        readOnly
                        className={cn(fieldClass, "bg-muted/40")}
                        value={new Date(monitoringWindow.monitoring_end_at).toLocaleDateString()}
                      />
                    </div>
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}

export type { ReleaseProtectionSettings };
