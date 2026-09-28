import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, LockKeyhole, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { submitEnquiry } from "@/lib/enquiry/enquiry.functions";
import {
  DEPARTMENT_OPTIONS,
  type EnquiryDepartment,
} from "@/lib/enquiry/enquiry.schema";

const contactFormSchema = z.object({
  department: z.enum([
    "protection",
    "security",
    "privacy",
    "partnership",
    "media",
    "general",
    "other",
  ]),
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().email("Enter a valid email address.").max(254),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a valid mobile number.")
    .max(24)
    .refine((value) => value.replace(/[^\d]/g, "").length >= 7, "Enter a valid mobile number."),
  organization: z.string().trim().max(160),
  message: z.string().trim().min(10, "Tell us a little more about your enquiry.").max(4000),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;
type FieldErrors = Partial<Record<keyof ContactFormValues, string>>;

const initialValues: ContactFormValues = {
  department: "protection",
  fullName: "",
  email: "",
  phone: "",
  organization: "",
  message: "",
};

const fieldClassName =
  "h-12 rounded-none border-0 border-b border-landing-line bg-transparent px-0 text-landing-ink shadow-none transition-[border-color,background-color] placeholder:text-landing-muted/65 focus-visible:border-landing-accent focus-visible:bg-landing-soft/45 focus-visible:ring-0";

export function ContactForm() {
  const submit = useServerFn(submitEnquiry);
  const [values, setValues] = useState<ContactFormValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [enquiryId, setEnquiryId] = useState<string | null>(null);

  function update<K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = contactFormSchema.safeParse(values);
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in nextErrors)) {
          nextErrors[key as keyof ContactFormValues] = issue.message;
        }
      }
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submit({
        data: {
          department: parsed.data.department,
          protectionService: null,
          profileType: null,
          profileName: null,
          roleTitle: null,
          securityTopic: null,
          privacyTopic: null,
          partnershipType: null,
          mediaType: null,
          fullName: parsed.data.fullName,
          email: parsed.data.email,
          phone: parsed.data.phone,
          organization: parsed.data.organization || null,
          message: parsed.data.message,
          platforms: null,
          relevantUrl: null,
          sourcePage: "/contact",
          sourceCta: "Contact form",
        },
      });
      if (result.status === "ERROR") {
        setSubmitError(result.message);
        return;
      }
      setEnquiryId(result.enquiryId);
    } catch {
      setSubmitError("We couldn't submit your enquiry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (enquiryId) {
    return (
      <div className="flex min-h-[430px] flex-col items-center justify-center px-6 py-16 text-center md:px-12">
        <span className="flex size-14 items-center justify-center rounded-full bg-landing-accent text-landing-accent-foreground shadow-lg shadow-landing-accent/20">
          <Check className="size-6" aria-hidden="true" />
        </span>
        <p className="landing-kicker mt-7">Message received</p>
        <h2 className="mt-3 text-3xl font-medium text-landing-ink">Thank you for contacting Eterna.</h2>
        <p className="mt-4 max-w-md text-sm leading-6 text-landing-muted">
          Your enquiry has been sent to the appropriate team. Keep this reference for your records.
        </p>
        <p className="mt-6 border border-landing-line bg-landing-soft px-4 py-2 font-mono text-xs text-landing-ink">
          {enquiryId}
        </p>
        <Button
          type="button"
          variant="link"
          className="mt-6 h-auto p-0 text-landing-ink"
          onClick={() => {
            setValues(initialValues);
            setEnquiryId(null);
          }}
        >
          Send another enquiry <ArrowRight />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid lg:grid-cols-[0.36fr_0.64fr]">
      <div className="relative overflow-hidden bg-landing-ink px-7 py-10 text-landing-accent-foreground md:px-10 md:py-12">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-landing-accent to-transparent" />
        <Send className="size-5 text-landing-accent" aria-hidden="true" />
        <p className="mt-12 text-xs font-semibold uppercase text-landing-accent">Direct enquiry</p>
        <h2 className="mt-4 max-w-xs text-3xl font-medium leading-tight">Tell us how we can help.</h2>
        <p className="mt-5 max-w-sm text-sm leading-6 text-landing-accent-foreground/65">
          Share the essential details. Your message will be directed to the team best placed to respond.
        </p>
        <div className="mt-14 flex items-center gap-2 border-t border-landing-accent-foreground/15 pt-5 text-xs text-landing-accent-foreground/55">
          <LockKeyhole className="size-3.5 text-landing-accent" aria-hidden="true" />
          Information is handled confidentially.
        </div>
      </div>

      <div className="bg-landing px-7 py-10 md:px-12 md:py-12">
        <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
          <Field label="Enquiry type" error={errors.department}>
            <Select
              value={values.department}
              onValueChange={(value) => update("department", value as EnquiryDepartment)}
            >
              <SelectTrigger
                aria-label="Enquiry type"
                className={`${fieldClassName} cursor-pointer rounded-none`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-landing-line bg-landing text-landing-ink">
                {DEPARTMENT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Full name" error={errors.fullName} required>
            <Input
              value={values.fullName}
              onChange={(event) => update("fullName", event.target.value)}
              autoComplete="name"
              placeholder="Your name"
              maxLength={120}
              className={fieldClassName}
              aria-invalid={Boolean(errors.fullName)}
            />
          </Field>

          <Field label="Work email" error={errors.email} required>
            <Input
              type="email"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
              autoComplete="email"
              placeholder="name@company.com"
              maxLength={254}
              className={fieldClassName}
              aria-invalid={Boolean(errors.email)}
            />
          </Field>

          <Field label="Mobile number" error={errors.phone} required>
            <Input
              type="tel"
              value={values.phone}
              onChange={(event) => update("phone", event.target.value)}
              autoComplete="tel"
              placeholder="Include country code"
              maxLength={24}
              className={fieldClassName}
              aria-invalid={Boolean(errors.phone)}
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="Organization" error={errors.organization}>
              <Input
                value={values.organization}
                onChange={(event) => update("organization", event.target.value)}
                autoComplete="organization"
                placeholder="Company, agency or organization (optional)"
                maxLength={160}
                className={fieldClassName}
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="How can we help?" error={errors.message} required>
              <Textarea
                value={values.message}
                onChange={(event) => update("message", event.target.value)}
                placeholder="Briefly describe what you need help with."
                maxLength={4000}
                className="min-h-32 resize-y rounded-none border-0 border-b border-landing-line bg-transparent px-0 py-3 text-landing-ink shadow-none transition-[border-color,background-color] placeholder:text-landing-muted/65 focus-visible:border-landing-accent focus-visible:bg-landing-soft/45 focus-visible:ring-0"
                aria-invalid={Boolean(errors.message)}
              />
            </Field>
          </div>
        </div>

        {submitError ? (
          <p role="alert" className="mt-6 text-sm font-medium text-destructive">
            {submitError}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-4 border-t border-landing-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xs text-xs leading-5 text-landing-muted">
            Required fields are marked with an asterisk.
          </p>
          <Button
            type="submit"
            disabled={submitting}
            className="group landing-accent-fill h-11 rounded-full px-6 text-landing-accent-foreground transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" /> Sending…
              </>
            ) : (
              <>
                Send enquiry
                <ArrowRight className="transition-transform duration-200 group-hover:translate-x-1" />
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  required = false,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase text-landing-muted">
        {label}
        {required ? <span className="ml-1 text-landing-accent">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}