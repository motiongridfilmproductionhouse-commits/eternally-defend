import { createFileRoute } from "@tanstack/react-router";
import { NewsroomArticle, newsroomArticleHead } from "@/components/public/NewsroomArticle";
import { TAKE_IT_DOWN } from "@/lib/content/topic-guides";

const ARTICLE = TAKE_IT_DOWN;

export const Route = createFileRoute("/newsroom_/take-it-down-act-guide")({
  head: () => newsroomArticleHead(ARTICLE),
  component: () => <NewsroomArticle a={ARTICLE} />,
});
