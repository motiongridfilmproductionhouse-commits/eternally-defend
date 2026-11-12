import { Asset, useRouter, useRouterState, useTags } from "@tanstack/react-router";
import { createElement } from "react";
import { completeShareTags } from "@/lib/seo/head-defaults";

/** HeadContent with share-tag completion (see completeShareTags). */
export function SeoHeadContent() {
  const notFound = useRouterState({
    select: (s) =>
      s.matches.some((m) => {
        const x = m as { status?: string; _notFound?: unknown; globalNotFound?: boolean };
        return x.status === "notFound" || Boolean(x._notFound) || x.globalNotFound === true;
      }),
  });
  const tags = completeShareTags(useTags() as Parameters<typeof completeShareTags>[0], { notFound });
  const nonce = useRouter().options.ssr?.nonce;
  return (
    <>
      {tags.map((tag) =>
        createElement(Asset as never, {
          ...(tag as object),
          key: `tsr-meta-${JSON.stringify(tag)}`,
          nonce,
        }),
      )}
    </>
  );
}
