import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  DEPARTMENT_OPTIONS,
  MEDIA_TYPE_OPTIONS,
  PARTNERSHIP_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
  PRIVACY_TOPIC_OPTIONS,
  PROFILE_TYPE_OPTIONS,
  PROTECTION_SERVICE_OPTIONS,
  SECURITY_TOPIC_OPTIONS,
  type EnquiryDepartment,
  type MediaType,
  type PartnershipType,
  type Platform,
  type PrivacyTopic,
  type ProfileType,
  type ProtectionService,
  type SecurityTopic,
} from "@/lib/enquiry/enquiry.schema";
import type { EnquiryFormState } from "./enquiry-form-state";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export function SelectableCard({
  title,
  description,
  selected,
  onSelect,
  compact = false,
}: {
  title: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group relative w-full rounded-xl border text-left transition-all duration-150 ease-out hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-accent/40",
        compact ? "px-4 py-3" : "px-5 py-4",
        selected
          ? "border-landing-ink/70 bg-landing-soft shadow-[0_2px_10px_-4px_rgba(15,23,42,0.18)]"
          : "border-landing-line bg-landing hover:border-landing-ink/30",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span>
          <span
            className={cn(
              "block font-semibold text-landing-ink",
              compact ? "text-sm" : "text-[15px]",
            )}
          >
            {title}
          </span>
          {description ? (
            <span className="mt-1 block text-xs leading-5 text-landing-muted">{description}</span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected
              ? "border-landing-ink bg-landing-ink text-landing"
              : "border-landing-line bg-transparent text-transparent",
          )}
        >
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      </span>
    </button>
  );
}

export function StepHeading({ heading, supporting }: { heading: string; supporting?: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-xl font-semibold tracking-[-0.01em] text-landing-ink sm:text-2xl">
        {heading}
      </h3>
      {supporting ? (
        <p className="mt-2 text-sm leading-6 text-landing-muted">{supporting}</p>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-landing-ink">
        {label}
        {required ? <span className="text-landing-accent"> *</span> : null}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

const fieldInputClassName =
  "h-11 w-full rounded-lg border border-landing-line bg-landing px-3.5 text-sm text-landing-ink outline-none transition placeholder:text-landing-muted/70 focus:border-landing-ink/40 focus:ring-4 focus:ring-landing-ink/5";

export { fieldInputClassName };

/* ------------------------------------------------------------------ */
/* Step 1 — How can we help?                                           */
/* ------------------------------------------------------------------ */

export function EnquiryStep({
  value,
  onChange,
}: {
  value: EnquiryDepartment | null;
  onChange: (v: EnquiryDepartment) => void;
}) {
  return (
    <div>
      <StepHeading
        heading="How can we help?"
        supporting="Choose the area that best matches your enquiry."
      />
      <div
        role="radiogroup"
        aria-label="How can we help?"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {DEPARTMENT_OPTIONS.map((opt) => (
          <SelectableCard
            key={opt.value}
            title={opt.title}
            selected={value === opt.value}
            onSelect={() => onChange(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Protection / Security / Privacy / Partnership / Media topic */
/* ------------------------------------------------------------------ */

export function ProtectionTopicStep({
  value,
  onChange,
}: {
  value: ProtectionService | null;
  onChange: (v: ProtectionService) => void;
}) {
  return (
    <div>
      <StepHeading
        heading="What would you like Eterna to help protect?"
        supporting="Choose the situation closest to what you're experiencing."
      />
      <div
        role="radiogroup"
        aria-label="Protection type"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {PROTECTION_SERVICE_OPTIONS.map((opt) => (
          <SelectableCard
            key={opt.value}
            title={opt.title}
            description={opt.description}
            selected={value === opt.value}
            onSelect={() => onChange(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}

export function SecurityTopicStep({
  value,
  onChange,
}: {
  value: SecurityTopic | null;
  onChange: (v: SecurityTopic) => void;
}) {
  return (
    <div>
      <StepHeading heading="Security enquiry" supporting="What is this security enquiry about?" />
      <div
        role="radiogroup"
        aria-label="Security topic"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {SECURITY_TOPIC_OPTIONS.map((opt) => (
          <SelectableCard
            key={opt.value}
            title={opt.title}
            selected={value === opt.value}
            onSelect={() => onChange(opt.value)}
            compact
          />
        ))}
      </div>
      {value === "responsible-disclosure" ? (
        <div className="mt-4 rounded-lg border border-landing-line bg-landing-soft px-4 py-3.5 text-sm leading-6 text-landing-ink">
          <p className="font-semibold">Found a security vulnerability?</p>
          <p className="mt-1 text-landing-muted">
            Report it directly to{" "}
            <a
              href="mailto:security@eternasentinel.com"
              className="font-medium text-landing-ink underline underline-offset-2"
            >
              security@eternasentinel.com
            </a>{" "}
            before disclosing it publicly — that's Eterna's dedicated responsible-disclosure channel
            and the fastest way to reach the security team. You're welcome to continue with this
            form for a general enquiry instead.
          </p>
        </div>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-landing-muted">
        Please do not submit passwords, authentication credentials or other secrets through this
        form.
      </p>
    </div>
  );
}

export function PrivacyTopicStep({
  value,
  onChange,
}: {
  value: PrivacyTopic | null;
  onChange: (v: PrivacyTopic) => void;
}) {
  return (
    <div>
      <StepHeading heading="Privacy enquiry" supporting="What would you like to do?" />
      <div
        role="radiogroup"
        aria-label="Privacy topic"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {PRIVACY_TOPIC_OPTIONS.map((opt) => (
          <SelectableCard
            key={opt.value}
            title={opt.title}
            selected={value === opt.value}
            onSelect={() => onChange(opt.value)}
            compact
          />
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-landing-muted">
        You can also reach the privacy team directly at{" "}
        <a
          href="mailto:privacy@eternasentinel.com"
          className="font-medium text-landing-ink underline underline-offset-2"
        >
          privacy@eternasentinel.com
        </a>
        .
      </p>
    </div>
  );
}

export function PartnershipTopicStep({
  value,
  onChange,
}: {
  value: PartnershipType | null;
  onChange: (v: PartnershipType) => void;
}) {
  return (
    <div>
      <StepHeading
        heading="Partnership enquiry"
        supporting="What kind of partnership did you have in mind?"
      />
      <div
        role="radiogroup"
        aria-label="Partnership type"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {PARTNERSHIP_TYPE_OPTIONS.map((opt) => (
          <SelectableCard
            key={opt.value}
            title={opt.title}
            selected={value === opt.value}
            onSelect={() => onChange(opt.value)}
            compact
          />
        ))}
      </div>
    </div>
  );
}

export function MediaTopicStep({
  value,
  onChange,
}: {
  value: MediaType | null;
  onChange: (v: MediaType) => void;
}) {
  return (
    <div>
      <StepHeading heading="Media / Press" supporting="What's this enquiry about?" />
      <div
        role="radiogroup"
        aria-label="Media enquiry type"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {MEDIA_TYPE_OPTIONS.map((opt) => (
          <SelectableCard
            key={opt.value}
            title={opt.title}
            selected={value === opt.value}
            onSelect={() => onChange(opt.value)}
            compact
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Who needs protection? (protection department only)         */
/* ------------------------------------------------------------------ */

export function ProfileStep({
  value,
  onChange,
  profileName,
  onProfileNameChange,
  roleTitle,
  onRoleTitleChange,
  organization,
  onOrganizationChange,
}: {
  value: ProfileType | null;
  onChange: (v: ProfileType) => void;
  profileName: string;
  onProfileNameChange: (v: string) => void;
  roleTitle: string;
  onRoleTitleChange: (v: string) => void;
  organization: string;
  onOrganizationChange: (v: string) => void;
}) {
  return (
    <div>
      <StepHeading heading="Who needs protection?" />
      <div
        role="radiogroup"
        aria-label="Who needs protection"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {PROFILE_TYPE_OPTIONS.map((opt) => (
          <SelectableCard
            key={opt.value}
            title={opt.title}
            description={opt.description}
            selected={value === opt.value}
            onSelect={() => onChange(opt.value)}
          />
        ))}
      </div>
      {value === "public-figure" ? (
        <div className="mt-4">
          <Field label="Public / Professional Name">
            <input
              className={fieldInputClassName}
              value={profileName}
              onChange={(e) => onProfileNameChange(e.target.value)}
              placeholder="The name this person is known by"
            />
          </Field>
        </div>
      ) : null}
      {value === "corporate" ? (
        <div className="mt-4">
          <Field label="Company / Organization Name">
            <input
              className={fieldInputClassName}
              value={organization}
              onChange={(e) => onOrganizationChange(e.target.value)}
              placeholder="Your company or organization"
            />
          </Field>
        </div>
      ) : null}
      {value === "representative" ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Person / Organization Represented">
            <input
              className={fieldInputClassName}
              value={profileName}
              onChange={(e) => onProfileNameChange(e.target.value)}
              placeholder="Who you're representing"
            />
          </Field>
          <Field label="Your relationship / role">
            <input
              className={fieldInputClassName}
              value={roleTitle}
              onChange={(e) => onRoleTitleChange(e.target.value)}
              placeholder="e.g. Manager, Legal counsel"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Platform chips (protection details step)                            */
/* ------------------------------------------------------------------ */

export function PlatformChips({
  value,
  onChange,
}: {
  value: Platform[];
  onChange: (v: Platform[]) => void;
}) {
  const toggle = (p: Platform) => {
    onChange(value.includes(p) ? value.filter((v) => v !== p) : [...value, p]);
  };
  return (
    <div>
      <span className="text-[13px] font-medium text-landing-ink">
        Where is the issue appearing?
      </span>
      <div className="mt-2 flex flex-wrap gap-2">
        {PLATFORM_OPTIONS.map((opt) => {
          const selected = value.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(opt.value)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-accent/40",
                selected
                  ? "border-landing-ink bg-landing-ink text-landing"
                  : "border-landing-line bg-landing text-landing-muted hover:border-landing-ink/30 hover:text-landing-ink",
              )}
            >
              {opt.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Details step content helpers                                        */
/* ------------------------------------------------------------------ */

export function messagePlaceholderFor(state: EnquiryFormState): string {
  switch (state.department) {
    case "protection":
      return "Briefly describe what is happening, where it appears, and what you would like Eterna to review.";
    case "security":
      return "Briefly describe the security-related issue or question.";
    case "privacy":
      return "Briefly describe your privacy request or concern.";
    case "partnership":
      return "Tell us about the partnership you would like to discuss.";
    case "media":
      return "Tell us what you're working on and what you need from Eterna.";
    default:
      return "Tell us a little about your enquiry.";
  }
}

/* ------------------------------------------------------------------ */
/* Step 4 — Details                                                    */
/* ------------------------------------------------------------------ */

export function DetailsStep({
  state,
  update,
}: {
  state: EnquiryFormState;
  update: <K extends keyof EnquiryFormState>(key: K, value: EnquiryFormState[K]) => void;
}) {
  return (
    <div>
      <StepHeading heading="Your details" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full Name" required>
          <input
            className={fieldInputClassName}
            value={state.fullName}
            onChange={(e) => update("fullName", e.target.value)}
            autoComplete="name"
            placeholder="Your full name"
            required
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            className={fieldInputClassName}
            value={state.email}
            onChange={(e) => update("email", e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </Field>
        <Field label="Phone / WhatsApp" required>
          <input
            type="tel"
            className={fieldInputClassName}
            value={state.phone}
            onChange={(e) => update("phone", e.target.value)}
            autoComplete="tel"
            placeholder="+1 555 000 0000"
            required
          />
        </Field>
        {state.profileType !== "corporate" ? (
          <Field label="Company / Organization">
            <input
              className={fieldInputClassName}
              value={state.organization}
              onChange={(e) => update("organization", e.target.value)}
              autoComplete="organization"
              placeholder="Optional"
            />
          </Field>
        ) : null}
        {state.profileType !== "representative" ? (
          <Field label="Role / Title">
            <input
              className={fieldInputClassName}
              value={state.roleTitle}
              onChange={(e) => update("roleTitle", e.target.value)}
              placeholder="Optional"
            />
          </Field>
        ) : null}
      </div>

      <div className="mt-6">
        <Field label="Tell us more">
          <textarea
            className={cn(fieldInputClassName, "h-28 resize-none py-3 leading-6")}
            value={state.message}
            onChange={(e) => update("message", e.target.value)}
            placeholder={messagePlaceholderFor(state)}
          />
        </Field>
      </div>

      {state.department === "protection" ? (
        <div className="mt-6">
          <PlatformChips value={state.platforms} onChange={(v) => update("platforms", v)} />
        </div>
      ) : null}

      {state.department === "protection" || state.department === "security" ? (
        <div className="mt-6">
          <Field label="Relevant URL">
            <input
              type="url"
              className={fieldInputClassName}
              value={state.relevantUrl}
              onChange={(e) => update("relevantUrl", e.target.value)}
              placeholder="https://"
            />
          </Field>
          <p className="mt-1.5 text-xs leading-5 text-landing-muted">
            You can provide one example link now. Additional information can be shared later.
          </p>
        </div>
      ) : null}

    </div>
  );
}
