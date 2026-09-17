import { createFileRoute, redirect } from "@tanstack/react-router";

const FORWARDED_PARAMETERS = [
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "referral",
] as const;

function safeForwardedValue(value: string | null) {
  if (
    !value ||
    value.length > 200 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return null;
  }
  return value;
}

export const Route = createFileRoute("/waitinglist")({
  beforeLoad: ({ location }) => {
    const incoming = new URLSearchParams(location.searchStr);
    const forwarded = new URLSearchParams({ enquiry: "protection" });

    for (const parameter of FORWARDED_PARAMETERS) {
      const value = safeForwardedValue(incoming.get(parameter));
      if (value) forwarded.set(parameter, value);
    }

    throw redirect({
      href: `/?${forwarded.toString()}`,
      statusCode: 301,
    });
  },
});
