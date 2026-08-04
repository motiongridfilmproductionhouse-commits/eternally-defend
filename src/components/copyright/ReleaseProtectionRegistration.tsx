/**
 * Release protection form state and serialization utilities.
 * UI lives in ProtectedWorkRegistrationModal + release-protection-form-ui.
 */

import type { ReleaseProtectionSettings, ReleaseType } from "@/lib/copyright/release-protection";

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
