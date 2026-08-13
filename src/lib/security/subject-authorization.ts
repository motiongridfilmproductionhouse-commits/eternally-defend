/**
 * Subject isolation core (pure, testable).
 *
 * Rule: a logged-in account may only scan / monitor / investigate / enforce for
 * the subject and assets registered + authorized for its own workspace.
 * The protected identity is always resolved server-side; client-supplied
 * target names are treated as untrusted hints only.
 */

export const DEMO_UNRESTRICTED_EMAILS = ["hellosreehari@gmail.com"] as const;

export const SUBJECT_ASSOCIATION_UNVERIFIED = "SUBJECT_ASSOCIATION_UNVERIFIED";

export type AuthorizedIdentity = {
  /** Canonical registered subject name (legal / company name). */
  primaryName: string;
  /** All authorized names: legal, stage/professional, trading, brands, campaign assets. */
  authorizedNames: string[];
  /** Confirmed official social handles (without @). */
  authorizedHandles: string[];
  /** Approved domains. */
  authorizedDomains: string[];
  accountType: string | null;
  /** Demo/testing account allowed to target arbitrary subjects for scanning only. */
  unrestricted: boolean;
};

export function isDemoUnrestrictedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return DEMO_UNRESTRICTED_EMAILS.includes(email.trim().toLowerCase() as never);
}

export function normalizeSubject(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0900-\u0DFF]+/g, " ")
    .trim();
}

const clean = (values: (string | null | undefined)[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const key = normalizeSubject(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

export type ProfileLike = {
  account_type?: string | null;
  onboarding_account_type?: string | null;
  client_type?: string | null;
  email?: string | null;
  legal_name?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  company_name?: string | null;
  company_brand_name?: string | null;
  website?: string | null;
  official_socials?: unknown;
  social_profiles?: unknown;
};

export type AssetLike = {
  name?: string | null;
  kind?: string | null;
  source_url?: string | null;
  active?: boolean | null;
};

function extractHandlesAndDomains(value: unknown): { handles: string[]; domains: string[] } {
  const handles: string[] = [];
  const domains: string[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      const raw = node.trim();
      if (!raw) return;
      if (raw.startsWith("@")) {
        handles.push(raw.slice(1));
        return;
      }
      try {
        const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
        domains.push(url.hostname.replace(/^www\./, "").toLowerCase());
        const seg = url.pathname.split("/").filter(Boolean)[0];
        if (seg) handles.push(seg.replace(/^@/, ""));
      } catch {
        handles.push(raw);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return { handles, domains };
}

export function buildAuthorizedIdentity(
  profile: ProfileLike | null | undefined,
  assets: AssetLike[] = [],
  options: { email?: string | null } = {},
): AuthorizedIdentity {
  const p = profile ?? {};
  const accountType = (p.onboarding_account_type || p.account_type || p.client_type || null) as
    | string
    | null;

  const isCompany = /company|business|enterprise|production/i.test(accountType ?? "");

  const primaryCandidates = isCompany
    ? [p.company_name, p.company_brand_name, p.legal_name, p.display_name, p.full_name]
    : [p.legal_name, p.full_name, p.display_name, p.company_name];

  const activeAssets = assets.filter((a) => a.active !== false);

  const socials = extractHandlesAndDomains([p.official_socials, p.social_profiles]);
  const assetSources = extractHandlesAndDomains(activeAssets.map((a) => a.source_url));
  const site = extractHandlesAndDomains(p.website);

  const authorizedNames = clean([
    ...primaryCandidates,
    p.company_brand_name,
    ...activeAssets.map((a) => a.name),
  ]);

  return {
    primaryName: clean(primaryCandidates)[0] ?? "",
    authorizedNames,
    authorizedHandles: clean([...socials.handles, ...assetSources.handles]),
    authorizedDomains: clean([...socials.domains, ...site.domains, ...assetSources.domains]).map(
      (d) => d.toLowerCase(),
    ),
    accountType,
    unrestricted: isDemoUnrestrictedEmail(options.email ?? p.email ?? null),
  };
}

/** True when `requested` refers to the workspace's authorized subject. */
export function isAuthorizedSubjectName(
  identity: AuthorizedIdentity,
  requested: string | null | undefined,
): boolean {
  const want = normalizeSubject(requested);
  if (!want) return true; // no override supplied → server value is used
  return identity.authorizedNames.some((name) => {
    const known = normalizeSubject(name);
    if (!known) return false;
    return known === want || known.includes(want) || want.includes(known);
  });
}

export class SubjectAuthorizationError extends Error {
  code = "SUBJECT_NOT_AUTHORIZED";
  constructor(message: string) {
    super(message);
    this.name = "SubjectAuthorizationError";
  }
}

/**
 * Resolves the scan target server-side.
 * - No registered subject → hard error (must finish onboarding).
 * - Client-supplied name that is not authorized → rejected (unless demo account).
 * - Aliases are filtered down to authorized aliases only.
 */
export function resolveScanTarget(
  identity: AuthorizedIdentity,
  requested?: { targetName?: string | null; aliases?: string[] | null },
): { targetName: string; aliases: string[]; unrestricted: boolean } {
  const requestedName = (requested?.targetName ?? "").trim();

  if (identity.unrestricted) {
    return {
      targetName: requestedName || identity.primaryName,
      aliases: clean(requested?.aliases ?? []),
      unrestricted: true,
    };
  }

  if (!identity.primaryName) {
    throw new SubjectAuthorizationError(
      "No registered protected subject for this account. Complete onboarding before running scans.",
    );
  }

  if (requestedName && !isAuthorizedSubjectName(identity, requestedName)) {
    throw new SubjectAuthorizationError(
      `Not authorized to monitor "${requestedName}". This account is registered to protect ${identity.primaryName}.`,
    );
  }

  const authorizedAliases = clean(requested?.aliases ?? []).filter((alias) =>
    isAuthorizedSubjectName(identity, alias),
  );

  return {
    // Always the server-side registered name — never the browser value.
    targetName: identity.primaryName,
    aliases:
      authorizedAliases.length > 0
        ? authorizedAliases
        : identity.authorizedNames.filter(
            (n) => normalizeSubject(n) !== normalizeSubject(identity.primaryName),
          ),
    unrestricted: false,
  };
}

/** Enforcement chain gate: stricter than scanning — demo accounts are NOT exempt. */
export function assertEnforcementAuthorized(input: {
  identity: AuthorizedIdentity;
  findingOwnerId: string | null | undefined;
  userId: string;
  subjectName?: string | null;
  subjectAssociation?: string | null;
  verified?: boolean;
}): void {
  if (!input.findingOwnerId || input.findingOwnerId !== input.userId) {
    throw new SubjectAuthorizationError("Enforcement blocked: finding does not belong to this workspace.");
  }
  if (input.subjectAssociation === SUBJECT_ASSOCIATION_UNVERIFIED) {
    throw new SubjectAuthorizationError(
      "Enforcement blocked: finding is not linked to your authorized protected subject.",
    );
  }
  if (input.verified === false) {
    throw new SubjectAuthorizationError("Enforcement blocked: finding is not verified.");
  }
  if (!input.identity.primaryName) {
    throw new SubjectAuthorizationError("Enforcement blocked: no authorized protected subject.");
  }
  if (input.subjectName && !isAuthorizedSubjectName(input.identity, input.subjectName)) {
    throw new SubjectAuthorizationError(
      "Enforcement blocked: target subject is not the authorized protected subject.",
    );
  }
}
