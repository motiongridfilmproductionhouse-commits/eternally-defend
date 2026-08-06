import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_partner/partner")({
  component: PartnerSectionLayout,
});

function PartnerSectionLayout() {
  return <Outlet />;
}
