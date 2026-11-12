import { createFileRoute } from "@tanstack/react-router";
import { NewsroomArticle, newsroomArticleHead } from "@/components/public/NewsroomArticle";
import { PLATFORM_GUIDES } from "@/lib/content/platform-guides";

const ARTICLE = PLATFORM_GUIDES.x;

export const Route = createFileRoute("/newsroom_/report-impersonation-account-x")({
  head: () => newsroomArticleHead(ARTICLE),
  component: () => <NewsroomArticle a={ARTICLE} />,
});
