import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { submitEnquiry } from "@/lib/enquiry/enquiry.functions";
import {
  DEPARTMENT_OPTIONS,
  MEDIA_TYPE_OPTIONS,
  PARTNERSHIP_TYPE_OPTIONS,
  PRIVACY_TOPIC_OPTIONS,
  PROFILE_TYPE_OPTIONS,
  PROTECTION_SERVICE_OPTIONS,
  SECURITY_TOPIC_OPTIONS,
  type EnquiryPrefill,
} from "@/lib/enquiry/enquiry.schema";
import {
  departmentTitle,
  initialFormState,
  stepsFor,
  type EnquiryFormState,
  type StepKey,
} from "./enquiry-form-state";
import {
  DetailsStep,
  EnquiryStep,
  MediaTopicStep,
  PartnershipTopicStep,
  PrivacyTopicStep,
  ProfileStep,
  ProtectionTopicStep,
  SecurityTopicStep,
} from "./EnquirySteps";
import { EnquiryVideoPanel } from "./EnquiryVideoPanel";

function labelFor<T extends string>(options: Array<{ value: T; title: string }>, value: T | null) {
  if (!value) return null;
  return options.find((o) => o.value === value)?.title ?? null;
}

function isTopicChosen(state: EnquiryFormState): boolean {
  switch (state.department) {
    case "protection":
      return state.protectionService !== null;
    case "security":
      return state.securityTopic !== null;
    case "privacy":
      return state.privacyTopic !== null;
    case "partnership":
      return state.partnershipType !== null;
    case "media":
      return state.mediaType !== null;
    default:
      return true;
  }
}

function isProfileChosen(state: EnquiryFormState): boolean {
  if (!state.profileType) return false;
  if (state.profileType === "public-figure") return state.profileName.trim().length > 0;
  if (state.profileType === "corporate") return state.organization.trim().length > 0;
  if (state.profileType === "representative") return state.profileName.trim().length > 0;
  return true;
}

function isValidUrl(v: string): boolean {
  if (!v.trim()) return true;
  return /^https?:\/\/.+/i.test(v.trim());
}

function isDetailsValid(state: EnquiryFormState): boolean {
  return (
    state.fullName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(state.email) &&
    state.phone.trim().replace(/[^\d]/g, "").length >= 7 &&
    isValidUrl(state.relevantUrl)
  );
}

export function EternaInquiryModal({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: EnquiryPrefill;
}) {
  const submit = useServerFn(submitEnquiry);

  const [state, setState] = useState<EnquiryFormState>(() => initialFormState(prefill));
  const [stepKey, setStepKey] = useState<StepKey>("enquiry");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ enquiryId: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevOpenRef = useRef(open);

  // Reset to a fresh form every time the modal is (re)opened with a new
  // prefill context (a different CTA), never mid-session while it's open.
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const initial = initialFormState(prefill);
      setState(initial);
      const steps = stepsFor(initial.department);
      // A CTA that already preselects a protection service/profile can
      // safely start the visitor further along — but always land on the
      // first step that still needs an answer, never skip a real choice.
      let landing: StepKey = "enquiry";
      if (initial.department) {
        landing = "topic";
        if (steps.some((s) => s.key === "topic") && !isTopicChosen(initial)) landing = "topic";
        else if (steps.some((s) => s.key === "profile")) landing = "profile";
        else landing = "details";
      }
      setStepKey(landing);
      setDirection("forward");
      setSubmitting(false);
      setSubmitError(null);
      setSuccess(null);
    }
    prevOpenRef.current = open;
  }, [open, prefill]);

  const steps = useMemo(() => stepsFor(state.department), [state.department]);
  const stepIndex = steps.findIndex((s) => s.key === stepKey);

  function update<K extends keyof EnquiryFormState>(key: K, value: EnquiryFormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function goTo(key: StepKey, dir: "forward" | "back") {
    setDirection(dir);
    setStepKey(key);
    bodyRef.current?.scrollTo({ top: 0 });
  }

  function goNext() {
    const idx = steps.findIndex((s) => s.key === stepKey);
    if (idx < steps.length - 1) goTo(steps[idx + 1].key, "forward");
  }

  function goBack() {
    const idx = steps.findIndex((s) => s.key === stepKey);
    if (idx > 0) goTo(steps[idx - 1].key, "back");
  }

  const canContinue = (() => {
    switch (stepKey) {
      case "enquiry":
        return state.department !== null;
      case "topic":
        return isTopicChosen(state);
      case "profile":
        return isProfileChosen(state);
      case "details":
        return isDetailsValid(state);
      default:
        return false;
    }
  })();

  const isLastStep = stepIndex === steps.length - 1;

  async function handlePrimaryAction() {
    if (!canContinue) return;
    if (!isLastStep) {
      goNext();
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const sourcePage = typeof window !== "undefined" ? window.location.pathname : null;
      const res = await submit({
        data: {
          department: state.department!,
          protectionService: state.protectionService,
          profileType: state.profileType,
          profileName: state.profileName.trim() || null,
          roleTitle: state.roleTitle.trim() || null,
          securityTopic: state.securityTopic,
          privacyTopic: state.privacyTopic,
          partnershipType: state.partnershipType,
          mediaType: state.mediaType,
          fullName: state.fullName.trim(),
          email: state.email.trim(),
          phone: state.phone.trim(),
          organization: state.organization.trim() || null,
          message: state.message.trim() || null,
          platforms: state.platforms.length ? state.platforms : null,
          relevantUrl: state.relevantUrl.trim() || null,
          sourcePage,
          sourceCta: prefill.sourceCta ?? null,
        },
      });
      if (res.status === "ERROR") {
        setSubmitError(res.message);
        return;
      }
      setSuccess({ enquiryId: res.enquiryId });
    } catch {
      setSubmitError("We couldn't submit your enquiry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmitAnother() {
    const initial = initialFormState({});
    setState(initial);
    setStepKey("enquiry");
    setDirection("forward");
    setSuccess(null);
    setSubmitError(null);
  }

  const title = departmentTitle(state.department);

  const summaryLines = useMemo(() => {
    if (!success) return [];
    const lines: Array<[string, string]> = [];
    lines.push(["Enquiry", departmentTitle(state.department)]);
    const serviceLabel = labelFor(PROTECTION_SERVICE_OPTIONS, state.protectionService);
    if (serviceLabel) lines.push(["Protection", serviceLabel]);
    const profileLabel = labelFor(PROFILE_TYPE_OPTIONS, state.profileType);
    if (profileLabel) lines.push(["Profile", profileLabel]);
    const securityLabel = labelFor(SECURITY_TOPIC_OPTIONS, state.securityTopic);
    if (securityLabel) lines.push(["Topic", securityLabel]);
    const privacyLabel = labelFor(PRIVACY_TOPIC_OPTIONS, state.privacyTopic);
    if (privacyLabel) lines.push(["Topic", privacyLabel]);
    const partnershipLabel = labelFor(PARTNERSHIP_TYPE_OPTIONS, state.partnershipType);
    if (partnershipLabel) lines.push(["Topic", partnershipLabel]);
    const mediaLabel = labelFor(MEDIA_TYPE_OPTIONS, state.mediaType);
    if (mediaLabel) lines.push(["Topic", mediaLabel]);
    return lines;
  }, [success, state]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-landing-ink/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-modal="true"
          className={cn(
            "eterna-enquiry-modal fixed inset-0 z-[100] flex flex-col overflow-hidden bg-landing text-landing-ink outline-none",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90vh] sm:w-[min(1000px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-landing-line",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:slide-out-to-bottom-2",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Contact Eterna Sentinel without leaving this page.
          </DialogPrimitive.Description>

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-landing-line px-5 py-4 sm:px-8">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-landing-ink sm:text-lg">
                {title}
              </p>
              {!success && steps.length > 1 ? (
                <ol className="mt-1.5 flex items-center gap-1.5" aria-label="Progress">
                  {steps.map((s, i) => (
                    <li key={s.key} className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 rounded-full transition-colors",
                          i <= stepIndex ? "bg-landing-ink" : "bg-landing-line",
                        )}
                        aria-hidden="true"
                      />
                      {i < steps.length - 1 ? (
                        <span className="text-[10px] text-landing-muted" aria-hidden="true">
                          ·
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="ml-4 flex size-8 shrink-0 items-center justify-center rounded-full text-landing-muted outline-none transition-colors hover:bg-landing-soft hover:text-landing-ink focus-visible:ring-2 focus-visible:ring-landing-accent/40"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto">
            <div className="lg:grid lg:min-h-full lg:grid-cols-[minmax(250px,0.38fr)_minmax(0,0.62fr)]">
              <EnquiryVideoPanel />
              <div className="px-5 py-6 sm:px-8 sm:py-8">
                {success ? (
                  <SuccessView
                    enquiryId={success.enquiryId}
                    summaryLines={summaryLines}
                    onClose={() => onOpenChange(false)}
                    onSubmitAnother={handleSubmitAnother}
                  />
                ) : (
                  <div
                    key={stepKey}
                    className={cn("eterna-enquiry-step", `eterna-enquiry-step--${direction}`)}
                  >
                    {stepKey === "enquiry" ? (
                      <EnquiryStep value={state.department} onChange={(v) => update("department", v)} />
                    ) : null}
                    {stepKey === "topic" && state.department === "protection" ? (
                      <ProtectionTopicStep
                        value={state.protectionService}
                        onChange={(v) => update("protectionService", v)}
                      />
                    ) : null}
                    {stepKey === "topic" && state.department === "security" ? (
                      <SecurityTopicStep value={state.securityTopic} onChange={(v) => update("securityTopic", v)} />
                    ) : null}
                    {stepKey === "topic" && state.department === "privacy" ? (
                      <PrivacyTopicStep value={state.privacyTopic} onChange={(v) => update("privacyTopic", v)} />
                    ) : null}
                    {stepKey === "topic" && state.department === "partnership" ? (
                      <PartnershipTopicStep value={state.partnershipType} onChange={(v) => update("partnershipType", v)} />
                    ) : null}
                    {stepKey === "topic" && state.department === "media" ? (
                      <MediaTopicStep value={state.mediaType} onChange={(v) => update("mediaType", v)} />
                    ) : null}
                    {stepKey === "profile" ? (
                      <ProfileStep
                        value={state.profileType}
                        onChange={(v) => update("profileType", v)}
                        profileName={state.profileName}
                        onProfileNameChange={(v) => update("profileName", v)}
                        roleTitle={state.roleTitle}
                        onRoleTitleChange={(v) => update("roleTitle", v)}
                        organization={state.organization}
                        onOrganizationChange={(v) => update("organization", v)}
                      />
                    ) : null}
                    {stepKey === "details" ? <DetailsStep state={state} update={update} /> : null}
                  </div>
                )}

                {submitError ? (
                  <p role="alert" className="mt-4 text-sm font-medium text-red-600">
                    {submitError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Footer */}
          {!success ? (
            <div className="flex shrink-0 items-center justify-between border-t border-landing-line px-5 py-4 sm:px-8">
              {stepIndex > 0 ? (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={submitting}
                  className="group inline-flex items-center gap-1.5 text-sm font-medium text-landing-muted outline-none transition-colors hover:text-landing-ink focus-visible:ring-2 focus-visible:ring-landing-accent/40 disabled:opacity-50"
                >
                  <ArrowLeft className="size-3.5 transition-transform duration-150 ease-out group-hover:-translate-x-1" />
                  Back
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={!canContinue || submitting}
                className="group landing-accent-fill inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-landing-accent-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-landing-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Submitting…
                  </>
                ) : isLastStep ? (
                  "Submit Request"
                ) : (
                  <>
                    Continue
                    <ArrowRight className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SuccessView({
  enquiryId,
  summaryLines,
  onClose,
  onSubmitAnother,
}: {
  enquiryId: string;
  summaryLines: Array<[string, string]>;
  onClose: () => void;
  onSubmitAnother: () => void;
}) {
  return (
    <div role="status" className="flex flex-col items-center py-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-landing-soft">
        <Check className="size-5 text-landing-ink" />
      </span>
      <h3 className="mt-5 text-xl font-semibold text-landing-ink sm:text-2xl">Enquiry received</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-landing-muted">
        Your enquiry has been submitted to the appropriate Eterna team.
      </p>
      {summaryLines.length ? (
        <div className="mt-6 w-full max-w-xs rounded-xl border border-landing-line bg-landing-soft px-5 py-4 text-left">
          {summaryLines.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1 text-sm">
              <span className="text-landing-muted">{k}</span>
              <span className="font-medium text-landing-ink">{v}</span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-4 text-xs text-landing-muted">Reference {enquiryId}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="landing-accent-fill rounded-full px-5 py-2.5 text-sm font-semibold text-landing-accent-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-landing-accent/40"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onSubmitAnother}
          className="rounded-full border border-landing-line px-5 py-2.5 text-sm font-semibold text-landing-ink outline-none transition-colors hover:bg-landing-soft focus-visible:ring-2 focus-visible:ring-landing-accent/40"
        >
          Submit another enquiry
        </button>
      </div>
    </div>
  );
}
