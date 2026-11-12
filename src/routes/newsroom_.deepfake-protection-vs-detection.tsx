import { createFileRoute } from "@tanstack/react-router";
import { NewsroomArticle, newsroomArticleHead } from "@/components/public/NewsroomArticle";
import { PROTECTION_VS_DETECTION } from "@/lib/content/topic-guides";

const ARTICLE = PROTECTION_VS_DETECTION;

export const Route = createFileRoute("/newsroom_/deepfake-protection-vs-detection")({
  head: () => newsroomArticleHead(ARTICLE),
  component: () => <NewsroomArticle a={ARTICLE} />,
});
