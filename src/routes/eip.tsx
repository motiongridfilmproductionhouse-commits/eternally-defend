import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Fingerprint, Lock } from "lucide-react";
import { useUserRoles } from "@/hooks/use-user-roles";

/** Product flag for the Eterna Image Immunization Platform. */
const EIP_ENABLED = true;
/** Entitlement reuses the existing role system (user_roles). */
const EIP_ROLES = new Set(["admin", "super_admin", "staff"]);

export const Route = createFileRoute("/eip")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "EIP Platform — Eterna Image Immunization" },
      {
        name: "description",
        content: "Pre-publication identity protection for authorized images.",
      },
      { property: "og:title", content: "EIP Platform — Eterna Image Immunization" },
      {
        property: "og:description",
        content: "Pre-publication identity protection for authorized images.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EipPage,
});

function EipPage() {
  const navigate = useNavigate();
  const { roles, ready, session } = useUserRoles();

  useEffect(() => {
    if (ready && !session) navigate({ to: "/auth", search: { redirect: "/eip" } as never, replace: true });
  }, [ready, session, navigate]);

  if (!ready || !session) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  const allowed = EIP_ENABLED && (roles as string[]).some((r) => EIP_ROLES.has(r));

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-blue-100 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto size-12 rounded-xl grid place-items-center bg-blue-50 text-blue-600">
          {allowed ? <Fingerprint className="size-6" aria-hidden /> : <Lock className="size-6" aria-hidden />}
        </div>
        {allowed ? (
          <>
            <p className="mt-5 text-[10px] font-semibold tracking-[0.22em] text-blue-600">IMAGE IMMUNIZATION</p>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Eterna Image Immunization</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Pre-publication identity protection for authorized images.
            </p>
            <p className="mt-6 rounded-lg bg-blue-50/60 px-4 py-3 text-sm text-blue-800">
              EIP Platform setup is in progress.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-5 font-display text-xl font-bold tracking-tight">
              EIP access is not enabled for this account.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Eterna Image Immunization is available to approved accounts and authorized identities.
              Contact Eterna to request access.
            </p>
            <a
              href="/contact"
              className="mt-6 inline-flex h-11 items-center rounded-md bg-blue-600 px-5 text-sm font-semibold text-primary-foreground hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              Request EIP Access
            </a>
          </>
        )}
        <div className="mt-6">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to Eterna
          </Link>
        </div>
      </div>
    </div>
  );
}
