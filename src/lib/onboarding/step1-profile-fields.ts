/**
 * Step 1 (Account & Client Profile) field visibility rules.
 *
 * Celebrity onboarding is personal / public-figure onboarding: it must not ask
 * for corporate identity fields. All other client types keep their existing
 * fields unchanged.
 */

export type Step1ClientType =
  | "individual"
  | "creator"
  | "celebrity"
  | "business"
  | "corporate"
  | "agency";

/** Client types that are corporate / representative in nature. */
const COMPANY_FIELD_CLIENT_TYPES = new Set<string>([
  "individual",
  "creator",
  "business",
  "corporate",
  "agency",
  // v2 representative account types, mapped into the same client-type field.
  "manager_agent",
  "pr_team",
  "legal_representative",
  "enterprise",
  "production_house",
]);

/** Whether Company Name / Role-Title inputs are rendered for this client type. */
export function showsCompanyFields(clientType: string | null | undefined): boolean {
  if (!clientType) return true;
  return COMPANY_FIELD_CLIENT_TYPES.has(clientType);
}

/** Whether Company Name is a required field for this client type. */
export function requiresCompanyName(clientType: string | null | undefined): boolean {
  return clientType === "business" || clientType === "corporate" || clientType === "agency";
}

export type Step1Form = {
  legal_name: string;
  display_name: string;
  company_name: string;
  role_title: string;
  email: string;
  phone: string;
  country: string;
  address: string;
  client_type: string;
};

/**
 * Builds the payload actually submitted. Hidden fields are never persisted, so
 * values typed while a representative type was selected cannot leak into a
 * celebrity profile.
 */
export function buildStep1Payload(form: Step1Form): Step1Form {
  if (showsCompanyFields(form.client_type)) return { ...form };
  return { ...form, company_name: "", role_title: "" };
}

/** Validation depends only on visible, required fields. */
export function isStep1Valid(form: Step1Form): boolean {
  if (!form.legal_name.trim() || !form.country.trim() || !form.email.trim()) return false;
  if (requiresCompanyName(form.client_type) && !form.company_name.trim()) return false;
  return true;
}
