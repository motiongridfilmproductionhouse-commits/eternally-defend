import { createFileRoute } from "@tanstack/react-router";
import { NewsroomArticle, newsroomArticleHead } from "@/components/public/NewsroomArticle";
import { PLATFORM_GUIDES } from "@/lib/content/platform-guides";

const ARTICLE = PLATFORM_GUIDES.linkedin;

export const Route = createFileRoute("/newsroom_/report-impersonation-account-linkedin")({
  head: () => newsroomArticleHead(ARTICLE),
  component: () => <NewsroomArticle a={ARTICLE} />,
});
