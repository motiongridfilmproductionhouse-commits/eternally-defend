export type BusinessReportingRoute = {
  route_type: string;
  applies_reason: string;
  required_evidence: string[];
  missing_evidence: string[];
  recipient: string;
  reporting_url: string | null;
  draft_body: string;
  human_approval_required: true;
};

export type ReportingIntelligence = {
  platform: string;
  reporting_path: string | null;
  impersonation_path: string | null;
  trademark_path: string | null;
  hosting_provider: string | null;
  registrar: string | null;
  abuse_contacts: string[];
  website_contact_page: string | null;
  routes: BusinessReportingRoute[];
  draft_only: true;
};

const PLATFORM_ROUTES: Record<string, string> = {
  youtube: "https://support.google.com/youtube/answer/2802027",
  reddit: "https://www.reddit.com/report",
  x: "https://help.x.com/en/forms",
  twitter: "https://help.x.com/en/forms",
  facebook: "https://www.facebook.com/help/contact/295309487309948",
  instagram: "https://help.instagram.com/contact/636276399721841",
};

export function buildBusinessReportingIntelligence(input: {
  source: string;
  category: string;
  url: string;
  infrastructure?: {
    registrar?: string | null;
    hosting_provider?: string | null;
    abuse_email?: string | null;
    registrar_abuse_email?: string | null;
    hosting_abuse_email?: string | null;
    contact_page?: string | null;
  } | null;
}): ReportingIntelligence {
  const platform = input.source.toLowerCase();
  const category = input.category.toLowerCase();
  const reporting_path = PLATFORM_ROUTES[platform] || null;
  const impersonation_path = /impersonation|fake|identity/.test(category) ? reporting_path : null;
  const trademark_path = /trademark|brand|misuse/.test(category) ? reporting_path : null;
  const routes: BusinessReportingRoute[] = [];
  const add = (
    route_type: string,
    reason: string,
    recipient: string,
    url: string | null,
    required: string[],
  ) => {
    const missing = required.filter((item) => item !== "source URL");
    routes.push({
      route_type,
      applies_reason: reason,
      required_evidence: required,
      missing_evidence: missing,
      recipient,
      reporting_url: url,
      draft_body: `Draft ${route_type} request for ${input.url}. Human approval is required before submission.`,
      human_approval_required: true,
    });
  };
  if (reporting_path)
    add(
      "platform_report",
      `The finding was discovered on ${input.source}.`,
      input.source,
      reporting_path,
      ["source URL", "screenshot", "business identity evidence"],
    );
  if (/impersonation|fake|identity/.test(category))
    add(
      "platform_impersonation",
      "The classification indicates possible impersonation or identity misuse.",
      input.source,
      impersonation_path,
      ["source URL", "account/page identifier", "official business identity evidence"],
    );
  if (/fraud|scam|payment/.test(category))
    add(
      "fraud_or_scam",
      "The classification indicates a possible fraud or scam pattern.",
      input.source,
      reporting_path,
      ["source URL", "transaction or solicitation evidence", "identity evidence"],
    );
  if (/trademark|brand|misuse/.test(category))
    add(
      "trademark_complaint",
      "The finding indicates possible trademark or brand misuse.",
      input.source,
      trademark_path,
      [
        "source URL",
        "trademark registration or authorization evidence",
        "side-by-side brand evidence",
      ],
    );
  if (/copyright|piracy|reupload/.test(category))
    add(
      "copyright_complaint",
      "The finding indicates possible unauthorized copyrighted material.",
      input.source,
      reporting_path,
      ["source URL", "copyright ownership evidence", "infringing content capture"],
    );
  if (/harassment|abuse|threat/.test(category))
    add(
      "harassment_report",
      "The finding indicates possible harassment or abusive conduct.",
      input.source,
      reporting_path,
      ["source URL", "complete context screenshot", "account identifier"],
    );
  if (/privacy|doxx|personal/.test(category))
    add(
      "privacy_report",
      "The finding indicates possible exposure of personal information.",
      input.source,
      reporting_path,
      ["source URL", "redacted screenshot", "affected-person authorization"],
    );
  if (input.infrastructure?.hosting_provider || input.infrastructure?.hosting_abuse_email)
    add(
      "hosting_abuse",
      "The website has an identified hosting provider or abuse contact.",
      input.infrastructure.hosting_provider || "Hosting provider",
      input.infrastructure.hosting_abuse_email
        ? `mailto:${input.infrastructure.hosting_abuse_email}`
        : null,
      ["source URL", "abuse evidence", "business identity evidence"],
    );
  if (input.infrastructure?.registrar || input.infrastructure?.registrar_abuse_email)
    add(
      "registrar_abuse",
      "The website has an identified registrar or registrar abuse contact.",
      input.infrastructure.registrar || "Registrar",
      input.infrastructure.registrar_abuse_email
        ? `mailto:${input.infrastructure.registrar_abuse_email}`
        : null,
      ["source URL", "domain registration evidence", "abuse evidence"],
    );
  add(
    "search_deindexing",
    "A search-engine request may be appropriate when a qualifying legal or privacy basis is documented.",
    "Search engine",
    "https://reportcontent.google.com/forms/rtbf",
    ["source URL", "legal or privacy basis", "identity evidence"],
  );
  if (input.infrastructure?.contact_page)
    add(
      "publisher_correction",
      "A website contact page is available for a factual correction request.",
      "Publisher",
      input.infrastructure.contact_page,
      ["source URL", "specific factual error", "correction evidence"],
    );
  return {
    platform: input.source,
    reporting_path,
    impersonation_path,
    trademark_path,
    hosting_provider: input.infrastructure?.hosting_provider || null,
    registrar: input.infrastructure?.registrar || null,
    abuse_contacts: [
      input.infrastructure?.abuse_email,
      input.infrastructure?.registrar_abuse_email,
      input.infrastructure?.hosting_abuse_email,
    ].filter((value): value is string => Boolean(value)),
    website_contact_page: input.infrastructure?.contact_page || null,
    routes,
    draft_only: true,
  };
}
