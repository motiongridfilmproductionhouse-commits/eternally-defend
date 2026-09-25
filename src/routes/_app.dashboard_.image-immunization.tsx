import { createFileRoute } from "@tanstack/react-router";
import { EipWorkspace } from "@/components/eip/EipWorkspace";

export const Route = createFileRoute("/_app/dashboard_/image-immunization")({
  head: () => ({
    meta: [
      { title: "Image Immunization — Eterna Sentinel" },
      { name: "description", content: "Pre-publication identity protection for authorized images." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EipWorkspace,
});
