import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Image as ImageIcon,
  Plus,
  Shield,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ProtectionReadinessPanel,
  ReleaseProtectionCenterForm,
  useReleaseProtectionReadiness,
} from "@/components/copyright/release-protection-form-ui";
import {
  defaultReleaseProtectionForm,
  formToReleaseProtectionSettings,
  type ReleaseProtectionFormState,
} from "@/components/copyright/ReleaseProtectionRegistration";
import { validateReleaseProtectionSettings } from "@/lib/copyright/release-protection";

const STEPS = [
  { id: 1, label: "Work identity" },
  { id: 2, label: "Reference material" },
  { id: 3, label: "Release protection" },
  { id: 4, label: "Review & activate" },
] as const;

const DRAFT_KEY = "copyright-registration-draft-v1";

export interface ProtectedWorkRegistrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onTitleChange: (v: string) => void;
  knownUrlsText: string;
  onKnownUrlsTextChange: (v: string) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  additionalVisualFiles: File[];
  onAdditionalVisualFilesChange: (files: File[]) => void;
  trailerFile: File | null;
  onTrailerFileChange: (file: File | null) => void;
  releaseProtectionForm: ReleaseProtectionFormState;
  onReleaseProtectionFormChange: (form: ReleaseProtectionFormState) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function ProtectedWorkRegistrationModal({
  open,
  onOpenChange,
  title,
  onTitleChange,
  knownUrlsText,
  onKnownUrlsTextChange,
  file,
  onFileChange,
  additionalVisualFiles,
  onAdditionalVisualFilesChange,
  trailerFile,
  onTrailerFileChange,
  releaseProtectionForm,
  onReleaseProtectionFormChange,
  onSubmit,
  isSubmitting,
}: ProtectedWorkRegistrationModalProps) {
  const [step, setStep] = useState(1);
  const [cadencePreset, setCadencePreset] = useState<"recommended" | "aggressive" | "custom">(
    "recommended",
  );
  const [coverageMode, setCoverageMode] = useState<"standard" | "known" | "full">("full");
  const fileRef = useRef<HTMLInputElement>(null);
  const additionalVisualRef = useRef<HTMLInputElement>(null);
  const trailerRef = useRef<HTMLInputElement>(null);

  const posterPreview = useObjectUrl(file);
  const additionalPreviews = useMemo(
    () => additionalVisualFiles.map((f) => URL.createObjectURL(f)),
    [additionalVisualFiles],
  );
  useEffect(
    () => () => additionalPreviews.forEach((u) => URL.revokeObjectURL(u)),
    [additionalPreviews],
  );

  const releaseYear = releaseProtectionForm.release_date
    ? releaseProtectionForm.release_date.slice(0, 4)
    : "—";

  const { canActivate, missing, validationErrors } = useReleaseProtectionReadiness({
    form: releaseProtectionForm,
    primaryPosterReady: Boolean(file),
    additionalVisualCount: additionalVisualFiles.length,
    videoReferenceCount: trailerFile ? 1 : 0,
  });

  const canProceedStep1 = Boolean(title.trim());
  const canProceedStep2 = Boolean(file);
  const canProceedStep3 =
    !releaseProtectionForm.enabled ||
    validateReleaseProtectionSettings(formToReleaseProtectionSettings(releaseProtectionForm))
      .length === 0;

  const activateDisabled =
    isSubmitting ||
    !file ||
    !title.trim() ||
    (releaseProtectionForm.enabled && !canActivate);

  const activateHint = useMemo(() => {
    if (!file) return "Upload a primary reference file.";
    if (!title.trim()) return "Enter the protected work title.";
    if (releaseProtectionForm.enabled && missing.length) {
      return `Missing: ${missing.join(", ")}.`;
    }
    if (releaseProtectionForm.enabled && validationErrors.length) {
      return validationErrors[0];
    }
    return null;
  }, [file, title, releaseProtectionForm.enabled, missing, validationErrors]);

  const saveDraft = () => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          title,
          knownUrlsText,
          releaseProtectionForm,
          step,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        title?: string;
        knownUrlsText?: string;
        releaseProtectionForm?: ReleaseProtectionFormState;
        step?: number;
      };
      if (draft.title && !title) onTitleChange(draft.title);
      if (draft.knownUrlsText && !knownUrlsText) onKnownUrlsTextChange(draft.knownUrlsText);
      if (draft.releaseProtectionForm) onReleaseProtectionFormChange(draft.releaseProtectionForm);
      if (draft.step) setStep(Math.min(4, Math.max(1, draft.step)));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const resetOnClose = () => {
    setStep(1);
    setCadencePreset("recommended");
    setCoverageMode("full");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetOnClose();
        onOpenChange(v);
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[88vh] w-[min(1280px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden",
          "rounded-2xl border border-border/50 bg-[#fafbfc] p-0 shadow-2xl dark:bg-background",
        )}
      >
        {/* Header */}
        <header className="shrink-0 border-b border-border/60 bg-white px-6 py-4 dark:bg-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Shield className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  Register Protected Work
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Build the reference package and activate release-day leak monitoring.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge variant="outline" className="text-xs">
                Draft
              </Badge>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Step {step} of 4
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Stepper */}
          <nav className="mt-4 flex gap-1 overflow-x-auto pb-1">
            {STEPS.map((s) => {
              const active = step === s.id;
              const done = step > s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(s.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : done
                        ? "border-border/60 bg-muted/40 text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted/30",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full text-[10px]",
                      active ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    {s.id}
                  </span>
                  {s.label}
                </button>
              );
            })}
          </nav>
        </header>

        {/* Body — 3 columns on lg */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-4 p-4 lg:grid-cols-[28%_44%_28%] lg:gap-5 lg:p-6">
            {/* Left — Protected work summary */}
            <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
              <div className="rounded-xl border border-border/60 bg-white p-4 shadow-sm dark:bg-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Protected Work
                </p>
                <div className="mt-3 overflow-hidden rounded-lg border border-border/50 bg-muted/20">
                  {posterPreview ? (
                    <img
                      src={posterPreview}
                      alt="Primary reference"
                      className="aspect-[2/3] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[2/3] flex-col items-center justify-center gap-2 text-muted-foreground">
                      <ImageIcon className="h-8 w-8 opacity-40" />
                      <span className="text-xs">No poster yet</span>
                    </div>
                  )}
                </div>
                <div className="mt-3 space-y-1">
                  <p className="truncate text-base font-semibold">{title || "Untitled work"}</p>
                  <p className="text-xs text-muted-foreground">Release year · {releaseYear}</p>
                  <p className="text-xs text-muted-foreground">
                    Language · {releaseProtectionForm.primary_language || "—"}
                  </p>
                  {releaseProtectionForm.studio && (
                    <p className="truncate text-xs text-muted-foreground">
                      Studio · {releaseProtectionForm.studio}
                    </p>
                  )}
                  {releaseProtectionForm.distributor && (
                    <p className="truncate text-xs text-muted-foreground">
                      Distributor · {releaseProtectionForm.distributor}
                    </p>
                  )}
                </div>

                <div className="mt-4 border-t border-border/50 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Reference package
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    <li className="flex justify-between">
                      <span>Primary poster</span>
                      <span className={file ? "text-emerald-600" : "text-muted-foreground"}>
                        {file ? "Added" : "Missing"}
                      </span>
                    </li>
                    <li className="flex justify-between">
                      <span>Additional visuals</span>
                      <span>{additionalVisualFiles.length} / 2+</span>
                    </li>
                    <li className="flex justify-between">
                      <span>Trailer / video</span>
                      <span>{trailerFile ? "1" : "0"} / 1</span>
                    </li>
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {additionalPreviews.map((src, i) => (
                      <img
                        key={src}
                        src={src}
                        alt={`Visual ${i + 1}`}
                        className="h-10 w-10 rounded border border-border/50 object-cover"
                      />
                    ))}
                    {trailerFile && (
                      <div className="flex h-10 w-10 items-center justify-center rounded border border-border/50 bg-muted/40">
                        <Film className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => setStep(2)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add references
                  </Button>
                </div>
              </div>
            </aside>

            {/* Center — step content */}
            <main className="min-w-0 space-y-4">
              {step === 1 && (
                <div className="rounded-xl border border-border/60 bg-white p-5 shadow-sm dark:bg-card">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Work identity
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium">Protected work title *</label>
                      <Input
                        className="h-11 rounded-lg"
                        value={title}
                        onChange={(e) => onTitleChange(e.target.value)}
                        placeholder="e.g. Vasantham — Official Poster"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium">
                        Known URLs to investigate (optional)
                      </label>
                      <textarea
                        value={knownUrlsText}
                        onChange={(e) => onKnownUrlsTextChange(e.target.value)}
                        rows={4}
                        placeholder="One URL per line · max 10 · http/https only"
                        className="w-full rounded-lg border border-border/70 bg-background px-3 py-2.5 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      />
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Seeds exact-page investigation only. Each URL still needs title identity and
                        distribution-access evidence.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border/60 bg-white p-5 shadow-sm dark:bg-card">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Primary reference
                    </p>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/*"
                      className="hidden"
                      onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full justify-start"
                      onClick={() => fileRef.current?.click()}
                    >
                      {file ? (
                        <>
                          {file.type.startsWith("video/") ? (
                            <Film className="mr-2 h-4 w-4" />
                          ) : (
                            <ImageIcon className="mr-2 h-4 w-4" />
                          )}
                          <span className="truncate">{file.name}</span>
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload primary poster or reference
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-white p-5 shadow-sm dark:bg-card">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Additional visuals (minimum 2 for release protection)
                    </p>
                    <input
                      ref={additionalVisualRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) =>
                        onAdditionalVisualFilesChange(Array.from(e.target.files ?? []).slice(0, 4))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full justify-start"
                      onClick={() => additionalVisualRef.current?.click()}
                    >
                      <ImageIcon className="mr-2 h-4 w-4" />
                      {additionalVisualFiles.length
                        ? `${additionalVisualFiles.length} visual(s) selected`
                        : "Upload additional official visuals"}
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-white p-5 shadow-sm dark:bg-card">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Trailer / approved video reference
                    </p>
                    <input
                      ref={trailerRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/*"
                      className="hidden"
                      onChange={(e) => onTrailerFileChange(e.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full justify-start"
                      onClick={() => trailerRef.current?.click()}
                    >
                      <Film className="mr-2 h-4 w-4" />
                      {trailerFile ? trailerFile.name : "Upload trailer or approved clip"}
                    </Button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <ReleaseProtectionCenterForm
                  form={releaseProtectionForm}
                  onChange={onReleaseProtectionFormChange}
                  cadencePreset={cadencePreset}
                  onCadencePresetChange={setCadencePreset}
                  coverageMode={coverageMode}
                  onCoverageModeChange={setCoverageMode}
                />
              )}

              {step === 4 && (
                <div className="rounded-xl border border-border/60 bg-white p-5 shadow-sm dark:bg-card">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Review & activate
                  </p>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Title</dt>
                      <dd className="font-medium">{title || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Release protection</dt>
                      <dd className="font-medium">
                        {releaseProtectionForm.enabled ? "Enabled" : "Manual scan only"}
                      </dd>
                    </div>
                    {releaseProtectionForm.enabled && (
                      <>
                        <div>
                          <dt className="text-xs text-muted-foreground">Release date</dt>
                          <dd className="font-medium">{releaseProtectionForm.release_date || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Timezone</dt>
                          <dd className="font-medium">{releaseProtectionForm.release_timezone}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Alert threshold</dt>
                          <dd className="font-medium">
                            {releaseProtectionForm.alert_threshold.replace(/_/g, " ")}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">References</dt>
                          <dd className="font-medium">
                            1 poster · {additionalVisualFiles.length} visuals ·{" "}
                            {trailerFile ? "1" : "0"} video
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  {validationErrors.length > 0 && (
                    <ul className="mt-4 space-y-1 text-xs text-destructive">
                      {validationErrors.map((err) => (
                        <li key={err}>• {err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </main>

            {/* Right — Readiness (hidden on small screens in step 1-2, shown below on tablet) */}
            <aside className="lg:sticky lg:top-0 lg:self-start">
              <ProtectionReadinessPanel
                form={releaseProtectionForm}
                primaryPosterReady={Boolean(file)}
                additionalVisualCount={additionalVisualFiles.length}
                videoReferenceCount={trailerFile ? 1 : 0}
              />
            </aside>
          </div>
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-border/60 bg-white px-4 py-3 dark:bg-card sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={saveDraft}>
                Save draft
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              {activateHint && step === 4 && (
                <span className="text-xs text-muted-foreground sm:mr-2">{activateHint}</span>
              )}
              {step > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep((s) => Math.max(1, s - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
              )}
              {step < 4 ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    (step === 1 && !canProceedStep1) ||
                    (step === 2 && !canProceedStep2) ||
                    (step === 3 && !canProceedStep3)
                  }
                  onClick={() => setStep((s) => Math.min(4, s + 1))}
                >
                  Continue
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={activateDisabled}
                  onClick={onSubmit}
                >
                  {releaseProtectionForm.enabled ? "Activate protection" : "Run detection"}
                </Button>
              )}
            </div>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export { defaultReleaseProtectionForm };
