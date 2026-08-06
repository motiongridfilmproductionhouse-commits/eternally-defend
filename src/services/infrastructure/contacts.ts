export interface ContactItem {
  email: string;
  category:
    | "abuse"
    | "legal"
    | "copyright"
    | "dmca"
    | "support"
    | "security"
    | "admin"
    | "technical"
    | "other";
  source: string;
  confidence: number;
}

export interface ContactDiscoveryResult {
  registrar?: string;
  contacts: ContactItem[];
  pagesScanned: string[];
  errors: string[];
}

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const PATHS = [
  "",
  "/contact",
  "/contact-us",
  "/about",
  "/legal",
  "/privacy",
  "/terms",
  "/copyright",
  "/dmca",
  "/report-abuse",
  "/support",
  "/help",
  "/.well-known/security.txt",
];

export async function discoverContacts(inputUrl: string): Promise<ContactDiscoveryResult> {
  const result: ContactDiscoveryResult = {
    contacts: [],
    pagesScanned: [],
    errors: [],
  };

  const base = normalizeUrl(inputUrl);

  for (const path of PATHS) {
    const url = `${base}${path}`;

    try {
      const res = await fetch(url);

      if (!res.ok) continue;

      result.pagesScanned.push(url);

      const html = await res.text();

      const matches = html.match(EMAIL_REGEX) || [];

      for (const email of matches) {
        addContact(result.contacts, {
          email,
          category: classify(email),
          source: url,
          confidence: 90,
        });
      }
    } catch {
      result.errors.push(url);
    }
  }

  return result;
}

function normalizeUrl(url: string) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}`;
}

function classify(email: string): ContactItem["category"] {
  const e = email.toLowerCase();

  if (e.includes("abuse")) return "abuse";
  if (e.includes("legal")) return "legal";
  if (e.includes("copyright")) return "copyright";
  if (e.includes("dmca")) return "dmca";
  if (e.includes("support")) return "support";
  if (e.includes("security")) return "security";
  if (e.includes("admin")) return "admin";
  if (e.includes("tech")) return "technical";

  return "other";
}

function addContact(list: ContactItem[], item: ContactItem) {
  if (!list.find((c) => c.email.toLowerCase() === item.email.toLowerCase())) {
    list.push(item);
  }
}
