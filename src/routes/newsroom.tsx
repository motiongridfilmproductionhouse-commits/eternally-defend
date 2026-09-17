import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/newsroom")({
  component: NewsroomLayout,
});

function NewsroomLayout() {
  return <Outlet />;
}
