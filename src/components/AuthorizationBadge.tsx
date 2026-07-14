import { CheckCircle2, ShieldAlert, ShieldCheck, Building2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAuthorization, type AuthzLevel } from "@/hooks/use-authorization";

const LEVEL_LABEL: Record<AuthzLevel, string> = {
  monitoring: "Monitoring Only",
  monitoring_evidence: "Evidence Authorized",
  monitoring_enforcement: "Enforcement Authorized",
  full_protection: "Full Protection",
};

export function AuthorizationBadge() {
  const { loading, completed, status, level } = useAuthorization();
  if (loading) return null;

  if (!completed) {
    return (
      <Link
        to="/onboarding"
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
      >
        <ShieldAlert className="size-4" /> Authorization pending
      </Link>
    );
  }

  const isEnterprise = status === "enterprise_authorized";
  const Icon = isEnterprise ? Building2 : level === "full_protection" ? ShieldCheck : CheckCircle2;
  const label = isEnterprise
    ? `Enterprise · ${level ? LEVEL_LABEL[level] : "Authorized"}`
    : level ? LEVEL_LABEL[level] : "Authorized";

  return (
    <Link
      to="/onboarding"
      className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
      title="View authorization details"
    >
      <Icon className="size-4" /> {label}
    </Link>
  );
}
