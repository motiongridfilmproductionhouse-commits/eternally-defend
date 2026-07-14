// Shared UI types + helpers only.
// The old mock DataProvider has been removed — all data now comes from the live database.

export type Severity = "Critical" | "High" | "Medium" | "Low";
export type Status = "Detected" | "In Review" | "Takedown Sent" | "Resolved";
export type Virality = "Normal" | "Growing" | "Viral" | "Exploding";

export type RiskType =
  | "Defamation"
  | "Impersonation"
  | "Deepfake"
  | "Copyright"
  | "Fraud"
  | "Scam"
  | "Brand Abuse"
  | "News Attack";

export const severityColor = (s: Severity): string => {
  switch (s) {
    case "Critical": return "oklch(0.63 0.24 25)";
    case "High": return "oklch(0.7 0.2 35)";
    case "Medium": return "oklch(0.75 0.16 70)";
    case "Low": return "oklch(0.68 0.16 155)";
  }
};
