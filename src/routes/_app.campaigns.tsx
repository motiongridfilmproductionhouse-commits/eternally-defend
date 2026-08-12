import { createFileRoute } from "@tanstack/react-router";
import { CampaignsWorkspace } from "@/components/celebrity/CampaignsWorkspace";

export const Route = createFileRoute("/_app/campaigns")({
  head: () => ({
    meta: [
      { title: "Copyright & Campaign Protection — Eterna" },
      {
        name: "description",
        content:
          "Protect film, music, advertisement and photoshoot campaigns by registering official assets for copyright monitoring.",
      },
      { property: "og:title", content: "Copyright & Campaign Protection — Eterna" },
      {
        property: "og:description",
        content: "Register official campaign assets and monitor for unauthorized copies.",
      },
    ],
  }),
  component: CampaignsWorkspace,
});
