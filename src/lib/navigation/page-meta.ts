/**
 * Canonical page titles for the app shell header.
 *
 * The old header used exact-pathname lookup against a partial map, so every
 * newer module (and every nested route) fell back to "Eterna Command Center" —
 * the header told operators they were on the dashboard while they were deep in
 * a results page. Lookup is now longest-prefix, so nested routes inherit the
 * right module title.
 */

export type PageMeta = { title: string; sub: string };

export const PAGE_META: Record<string, PageMeta> = {
  "/": { title: "Eterna Command Center", sub: "Mission control for digital reputation protection" },
  "/onboarding": {
    title: "Verification & Authorization",
    sub: "Identity, assets and legal authorization",
  },
  "/assets": { title: "Protected Assets", sub: "Register, monitor and manage your digital assets" },
  "/scan": { title: "Web Scan", sub: "Deep, surface and social web reconnaissance" },
  "/threat-radar": {
    title: "Threat Radar",
    sub: "Live threat stream across every monitored surface",
  },
  "/threat-monitoring": {
    title: "Threat Monitoring",
    sub: "Continuous AI monitoring across platforms",
  },
  "/intelligence": { title: "Evidence Analysis", sub: "AI insights and predictive risk analytics" },
  "/narrative-intelligence": {
    title: "Narrative Intelligence",
    sub: "Coordinated claims and narrative spread",
  },
  "/channel-watch": {
    title: "Channel Watch",
    sub: "Persistent monitoring of external channels",
  },
  "/youtube-removal": {
    title: "YouTube Removal Intelligence",
    sub: "Verified removal candidates and review queue",
  },
  "/face-protection": {
    title: "Face Protection",
    sub: "Enrolled faces and biometric match registry",
  },
  "/sensitive-protection": {
    title: "Intimate Image & Deepfake Protection",
    sub: "Priority handling for sensitive imagery",
  },
  "/deepfake-intel": {
    title: "Deepfake Intelligence",
    sub: "Synthetic media and face-swap detection",
  },
  "/copyright-intel": {
    title: "Copyright Intelligence",
    sub: "Unauthorized distribution and re-upload evidence",
  },
  "/campaigns": { title: "Campaign Protection", sub: "Release windows and campaign monitoring" },
  "/enforcement": {
    title: "Enforcement Center",
    sub: "Automated takedowns, reports and legal escalations",
  },
  "/cases": { title: "Case Management", sub: "Track and coordinate active protection cases" },
  "/removals": { title: "Removal Center", sub: "Submitted takedowns and removal status" },
  "/evidence-vault": { title: "Evidence Vault", sub: "Preserved evidence and chain of custody" },
  "/reports": { title: "Reports", sub: "Exportable protection and enforcement reports" },
  "/settings": { title: "Settings", sub: "Account, plan, security and preferences" },
  "/notifications": { title: "Notifications", sub: "Alerts, mentions and system messages" },
  "/admin": { title: "Admin Console", sub: "Platform operations and provider health" },
  "/partner": { title: "Partner Portal", sub: "Clients, proposals and commissions" },
};

export function pageMetaFor(pathname: string): PageMeta {
  if (pathname === "/") return PAGE_META["/"];
  let best: PageMeta | null = null;
  let bestLen = 0;
  for (const [prefix, meta] of Object.entries(PAGE_META)) {
    if (prefix === "/") continue;
    if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && prefix.length > bestLen) {
      best = meta;
      bestLen = prefix.length;
    }
  }
  return best ?? PAGE_META["/"];
}
