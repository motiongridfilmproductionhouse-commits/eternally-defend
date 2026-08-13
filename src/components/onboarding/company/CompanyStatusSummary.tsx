import { CheckCircle2, Clock, Lock, Radar, XCircle } from "lucide-react";
import type { CompanySubmissionStatus } from "@/lib/onboarding/company-authorization-letter";

/**
 * Company verification submission summary.
 *
 * Deliberately never labels the company "Verified" — submitted documents and a
 * signed authorization are evidence and assertions only.
 */
export function CompanyStatusSummary({ status }: { status: CompanySubmissionStatus }) {
  const rows = [
    {
      label: "Registration proof",
      value: status.registrationProof,
      tone: status.registrationProof === "Submitted" ? "ok" : "bad",
    },
    {
      label: "Authorization letter",
      value: status.authorizationLetter,
      tone: status.authorizationLetter === "Signed" ? "ok" : "bad",
    },
    { label: "Company authority", value: status.companyAuthority, tone: "pending" },
    { label: "Monitoring", value: status.monitoring, tone: "active" },
    { label: "Enforcement / Takedowns", value: status.enforcement, tone: "locked" },
  ] as const;

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="text-sm font-semibold">Company verification submitted</div>
      <div className="space-y-2 pt-1">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <span className="text-white/55">{row.label}</span>
            <span className="flex items-center gap-1.5 text-right text-white/85">
              <Icon tone={row.tone} />
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <p className="pt-2 text-[11px] leading-relaxed text-white/45">
        Uploaded documents and the signed authorization establish submitted evidence and
        authorization assertions. Verified status follows the platform review process.
      </p>
    </div>
  );
}

function Icon({ tone }: { tone: string }) {
  if (tone === "ok") return <CheckCircle2 className="size-3.5 text-emerald-400" />;
  if (tone === "bad") return <XCircle className="size-3.5 text-rose-400" />;
  if (tone === "active") return <Radar className="size-3.5 text-sky-300" />;
  if (tone === "locked") return <Lock className="size-3.5 text-amber-300" />;
  return <Clock className="size-3.5 text-amber-300" />;
}
