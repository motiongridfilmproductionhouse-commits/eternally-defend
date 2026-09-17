import type {
  EnquiryDepartment,
  EnquiryPrefill,
  MediaType,
  PartnershipType,
  Platform,
  PrivacyTopic,
  ProfileType,
  ProtectionService,
  SecurityTopic,
} from "@/lib/enquiry/enquiry.schema";

export interface EnquiryFormState {
  department: EnquiryDepartment | null;
  protectionService: ProtectionService | null;
  profileType: ProfileType | null;
  profileName: string;
  roleTitle: string;
  securityTopic: SecurityTopic | null;
  privacyTopic: PrivacyTopic | null;
  partnershipType: PartnershipType | null;
  mediaType: MediaType | null;
  fullName: string;
  email: string;
  phone: string;
  organization: string;
  message: string;
  platforms: Platform[];
  relevantUrl: string;
}

export function initialFormState(prefill: EnquiryPrefill): EnquiryFormState {
  return {
    department: prefill.department ?? null,
    protectionService: prefill.protectionService ?? null,
    profileType: prefill.profileType ?? null,
    profileName: "",
    roleTitle: "",
    securityTopic: null,
    privacyTopic: null,
    partnershipType: null,
    mediaType: null,
    fullName: "",
    email: "",
    phone: "",
    organization: "",
    message: "",
    platforms: [],
    relevantUrl: "",
  };
}

export type StepKey = "enquiry" | "topic" | "profile" | "details";

export interface StepDef {
  key: StepKey;
  label: string;
}

/** Which steps apply, in order, for the current department — recomputed live as the visitor changes their answer. */
export function stepsFor(department: EnquiryDepartment | null): StepDef[] {
  const steps: StepDef[] = [{ key: "enquiry", label: "Enquiry" }];
  if (department === "protection") {
    steps.push({ key: "topic", label: "Protection" });
    steps.push({ key: "profile", label: "Profile" });
  } else if (
    department === "security" ||
    department === "privacy" ||
    department === "partnership" ||
    department === "media"
  ) {
    steps.push({ key: "topic", label: "Topic" });
  }
  steps.push({ key: "details", label: "Details" });
  return steps;
}

export function departmentTitle(department: EnquiryDepartment | null): string {
  switch (department) {
    case "protection":
      return "Request Protection";
    case "security":
      return "Security Enquiry";
    case "privacy":
      return "Privacy Enquiry";
    case "partnership":
      return "Partnership Enquiry";
    case "media":
      return "Media / Press";
    case "general":
      return "General Enquiry";
    default:
      return "Contact Eterna";
  }
}
