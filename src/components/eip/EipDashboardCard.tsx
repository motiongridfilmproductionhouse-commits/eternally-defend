import { Link } from "@tanstack/react-router";
import { Fingerprint } from "lucide-react";
import { summarize } from "@/lib/eip/eip-data";
import { EipStatusBadge } from "./EipParts";
import { useEipAccess, useEipData } from "./EipWorkspace";

export function EipDashboardCard() {
  const access = useEipAccess();
  const data = useEipData("mine");
  const s = summarize(data.data?.jobs ?? [], data.data?.evaluations ?? []);
  return (
    <div className="card-surface p-5 flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="size-10 shrink-0 grid place-items-center rounded-lg bg-primary/10 text-primary">
          <Fingerprint className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-foreground">Image Immunization</div>
          <div className="text-xs text-muted-foreground">
            Protect authorized images before publication with Eterna EIP.
          </div>
        </div>
      </div>
      {access.enabled && (
        <div className="flex items-center gap-5 text-sm">
          <span>
            <b>{s.protected}</b> <span className="text-muted-foreground">protected</span>
          </span>
          <span>
            <b>{s.processing}</b> <span className="text-muted-foreground">processing</span>
          </span>
          {s.latest && <EipStatusBadge status={s.latest.status} />}
        </div>
      )}
      <Link
        to="/dashboard/image-immunization"
        className="text-sm font-semibold text-primary hover:underline shrink-0"
      >
        Open Image Immunization →
      </Link>
    </div>
  );
}
