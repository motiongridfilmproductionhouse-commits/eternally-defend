import { Card } from "@/components/ui/card";

export function PartnerStat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
        <Icon className="size-4" />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
    </Card>
  );
}

export function PartnerStatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    LEAD: "bg-slate-100 text-slate-700",
    ONBOARDING: "bg-blue-100 text-blue-700",
    ACTIVE: "bg-indigo-100 text-indigo-700",
    PAID: "bg-emerald-100 text-emerald-700",
    REFUNDED: "bg-amber-100 text-amber-700",
    REJECTED: "bg-red-100 text-red-700",
    CANCELLED: "bg-slate-100 text-slate-500",
    PENDING: "bg-amber-100 text-amber-700",
    PAYABLE: "bg-blue-100 text-blue-700",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${map[status] ?? "bg-slate-100"}`}
    >
      {status}
    </span>
  );
}

export function fmtInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}
