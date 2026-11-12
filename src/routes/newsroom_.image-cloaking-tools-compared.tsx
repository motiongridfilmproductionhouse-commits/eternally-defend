import { createFileRoute } from "@tanstack/react-router";
import { NewsroomArticle, newsroomArticleHead } from "@/components/public/NewsroomArticle";
import { IMAGE_CLOAKING } from "@/lib/content/topic-guides";

const ARTICLE = IMAGE_CLOAKING;

export const Route = createFileRoute("/newsroom_/image-cloaking-tools-compared")({
  head: () => newsroomArticleHead(ARTICLE),
  component: () => <NewsroomArticle a={ARTICLE} />,
});
