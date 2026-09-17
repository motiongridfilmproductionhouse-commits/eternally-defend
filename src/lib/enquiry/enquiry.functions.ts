import { createServerFn } from "@tanstack/react-start";

import { normalizePhone, publicClient } from "@/lib/waitlist/waitlist.functions";
import {
  DEPARTMENT_OPTIONS,
  EnquirySubmissionInput,
  MEDIA_TYPE_OPTIONS,
  PARTNERSHIP_TYPE_OPTIONS,
  PRIVACY_TOPIC_OPTIONS,
  PROFILE_TYPE_OPTIONS,
  PROTECTION_SERVICE_OPTIONS,
  SECURITY_TOPIC_OPTIONS,
} from "./enquiry.schema";

/**
 * Public, unauthenticated submission endpoint for the universal enquiry
 * modal (EternaInquiryModal). Reuses the exact same infrastructure as
 * /waitinglist: the `join_waitlist` SECURITY DEFINER RPC (extended — see
 * supabase/migrations/20260917174542_universal_enquiry_modal_fields.sql —
 * with nullable enquiry-taxonomy columns/params), the same
 * `waitlist_signups` table, and the same Resend-based admin alert pattern.
 * This is deliberately NOT a second lead store.
 */

function labelFor<T extends string>(
  options: Array<{ value: T; title: string }>,
  value: T | null | undefined,
): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.title ?? value;
}

/**
 * The `waitlist_signups.persona` column / `join_waitlist` RPC still expects
 * one of the original four values (enforced by the RPC itself), so every
 * enquiry — even ones outside the Protection department where the modal
 * never asks a "profile type" question — maps down to the closest of the
 * four for backward compatibility with that existing constraint.
 */
function personaFor(profileType: EnquirySubmissionInput["profileType"]): string {
  switch (profileType) {
    case "public-figure":
    case "individual":
      return "Individual";
    case "corporate":
      return "Organization";
    case "representative":
      return "Professional";
    default:
      return "Individual";
  }
}

export type SubmitEnquiryResult =
  | { status: "JOINED"; enquiryId: string }
  | { status: "ALREADY_JOINED"; enquiryId: string }
  | { status: "ERROR"; message: string };

export const submitEnquiry = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => EnquirySubmissionInput.parse(d))
  .handler(async ({ data }): Promise<SubmitEnquiryResult> => {
    const emailNormalized = data.email.trim().toLowerCase();
    const phoneNormalized = normalizePhone(data.phone);
    if (phoneNormalized.length < 7) {
      return { status: "ERROR", message: "Please enter a valid mobile number." };
    }

    const departmentLabel = labelFor(DEPARTMENT_OPTIONS, data.department) ?? data.department;
    const protectionServiceLabel = labelFor(PROTECTION_SERVICE_OPTIONS, data.protectionService);
    const profileTypeLabel = labelFor(PROFILE_TYPE_OPTIONS, data.profileType);
    const securityTopicLabel = labelFor(SECURITY_TOPIC_OPTIONS, data.securityTopic);
    const privacyTopicLabel = labelFor(PRIVACY_TOPIC_OPTIONS, data.privacyTopic);
    const partnershipTypeLabel = labelFor(PARTNERSHIP_TYPE_OPTIONS, data.partnershipType);
    const mediaTypeLabel = labelFor(MEDIA_TYPE_OPTIONS, data.mediaType);

    const { data: rows, error } = await publicClient().rpc("join_waitlist", {
      p_full_name: data.fullName,
      p_email: data.email,
      p_email_normalized: emailNormalized,
      p_phone: data.phone,
      p_phone_normalized: phoneNormalized,
      p_persona: personaFor(data.profileType),
      p_organization: data.organization?.trim() || null,
      p_source: data.sourceCta ?? null,
      p_utm_source: null,
      p_utm_medium: null,
      p_utm_campaign: null,
      p_referrer: data.sourcePage ?? null,
      p_enquiry_department: data.department,
      p_protection_service: data.protectionService ?? null,
      p_profile_type: data.profileType ?? null,
      p_profile_name: data.profileName?.trim() || null,
      p_role_title: data.roleTitle?.trim() || null,
      p_security_topic: data.securityTopic ?? null,
      p_privacy_topic: data.privacyTopic ?? null,
      p_partnership_type: data.partnershipType ?? null,
      p_media_type: data.mediaType ?? null,
      p_message: data.message?.trim() || null,
      p_platforms: data.platforms && data.platforms.length ? data.platforms : null,
      p_relevant_url: data.relevantUrl?.trim() || null,
      p_source_page: data.sourcePage ?? null,
      p_source_cta: data.sourceCta ?? null,
      p_id_prefix: "ET-EQ-",
    });

    const row = (
      rows as Array<{ result_status: string; result_waitlist_id: string | null }> | null
    )?.[0];

    if (error || !row) {
      console.error("[enquiry] rpc failed", error?.message ?? "no row returned");
      return {
        status: "ERROR",
        message: "We couldn't submit your enquiry. Please try again.",
      };
    }

    if (row.result_status === "ALREADY_JOINED" && row.result_waitlist_id) {
      return { status: "ALREADY_JOINED", enquiryId: row.result_waitlist_id };
    }

    if (row.result_status !== "JOINED" || !row.result_waitlist_id) {
      return { status: "ERROR", message: "Please check your details and try again." };
    }

    const enquiryId = row.result_waitlist_id;

    try {
      const { sendEnquiryAdminAlert } = await import("@/lib/waitlist/admin-alert.server");
      const alert = await sendEnquiryAdminAlert({
        waitlistId: enquiryId,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        organization: data.organization?.trim() || null,
        roleTitle: data.roleTitle?.trim() || null,
        department: departmentLabel,
        protectionService: protectionServiceLabel,
        profileType: profileTypeLabel,
        profileName: data.profileName?.trim() || null,
        securityTopic: securityTopicLabel,
        privacyTopic: privacyTopicLabel,
        partnershipType: partnershipTypeLabel,
        mediaType: mediaTypeLabel,
        message: data.message ?? null,
        platforms: data.platforms ?? null,
        relevantUrl: data.relevantUrl?.trim() || null,
        sourcePage: data.sourcePage ?? null,
        sourceCta: data.sourceCta ?? null,
      });
      if (!alert.ok) console.error("[enquiry] admin alert failed:", alert.error);
    } catch (err) {
      console.error("[enquiry] admin alert threw:", (err as Error)?.message);
    }

    return { status: "JOINED", enquiryId };
  });
