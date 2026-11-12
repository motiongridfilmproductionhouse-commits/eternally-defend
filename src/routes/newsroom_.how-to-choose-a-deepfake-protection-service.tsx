import { createFileRoute } from "@tanstack/react-router";
import { NewsroomArticle, newsroomArticleHead } from "@/components/public/NewsroomArticle";
import { CHOOSE_SERVICE } from "@/lib/content/topic-guides";

const ARTICLE = CHOOSE_SERVICE;

export const Route = createFileRoute("/newsroom_/how-to-choose-a-deepfake-protection-service")({
  head: () => newsroomArticleHead(ARTICLE),
  component: () => <NewsroomArticle a={ARTICLE} />,
});
