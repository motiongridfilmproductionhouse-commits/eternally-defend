import { filterDeepfakeCandidates } from "../../src/lib/deepfake/filter.server.ts";

const target = { name: "Maya Kapoor", aliases: [], handles: [] };

const hit = {
  url: "https://abuse-mirror.example/post/12345",
  title: "Maya Kapoor exclusive clip",
  description: "Watch now",
  query: '"Maya Kapoor" deepfake',
  media_type: "video",
  media_url: "https://abuse-mirror.example/media/clip.mp4",
  // Deliberately no image_url / thumbnail_url — provider only returned the
  // direct video URL, which is common for video-hosting result pages.
};

const result = filterDeepfakeCandidates([hit], target);
console.log(
  JSON.stringify(
    {
      decision: [...result.accepted, ...result.triage, ...result.rejected].map((c) => ({
        url: c.url,
        candidate_decision: c.candidate_decision,
        rejection_reason: c.rejection_reason,
      })),
    },
    null,
    2,
  ),
);
