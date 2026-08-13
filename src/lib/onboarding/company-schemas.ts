import { z } from "zod";
import { COMPANY_AUTHORITY_DOC_TYPES, COMPANY_RELATIONSHIPS } from "./company-config";
import { COMPANY_SOCIAL_PLATFORMS } from "./company-official-profiles";

export const CompanyProfileSchema = z.object({
  legal_company_name: z.string().trim().min(2).max(200),
  brand_name: z.string().trim().max(200).optional().nullable(),
  website: z.string().trim().min(3).max(300),
  country: z.string().trim().min(1).max(80),
  business_address: z.string().trim().max(500).optional().nullable(),
  registration_number: z.string().trim().max(120).optional().nullable(),
  business_email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
});
export type CompanyProfileInput = z.infer<typeof CompanyProfileSchema>;

export const CompanyRepresentativeSchema = z.object({
  full_legal_name: z.string().trim().min(2).max(200),
  job_title: z.string().trim().min(1).max(160),
  work_email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  relationship: z.enum(COMPANY_RELATIONSHIPS),
  relationship_other: z.string().trim().max(160).optional().nullable(),
});
export type CompanyRepresentativeInput = z.infer<typeof CompanyRepresentativeSchema>;

export const CompanyAuthorityDocSchema = z.object({
  doc_type: z.enum(COMPANY_AUTHORITY_DOC_TYPES),
  filename: z.string().trim().min(1).max(200),
  mime_type: z.string().trim().max(120).optional().nullable(),
  file_base64: z.string().min(16).max(14_000_000),
  note: z.string().trim().max(500).optional().nullable(),
});
export type CompanyAuthorityDocInput = z.infer<typeof CompanyAuthorityDocSchema>;

export const CompanyServicesSchema = z.object({
  services: z.array(z.string().trim().min(1).max(80)).max(30),
});

export const CompanyOtpVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const CompanyOfficialProfilesSchema = z.object({
  profiles: z
    .array(
      z.object({
        platform: z.enum(COMPANY_SOCIAL_PLATFORMS),
        url: z.string().trim().max(500),
        label: z.string().trim().max(120).optional().nullable(),
      }),
    )
    .max(30),
});
export type CompanyOfficialProfilesInput = z.infer<typeof CompanyOfficialProfilesSchema>;
