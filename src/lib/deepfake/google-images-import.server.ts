export type ParsedGoogleImagesUrl = {
  originalUrl: string;
  query: string;
};

export function parseGoogleImagesUrl(input: string): ParsedGoogleImagesUrl {
  const value = input.trim();

  if (!value) {
    throw new Error("Google Images URL is empty.");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid Google Images search URL.");
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  const isGoogleHost =
    host === "google.com" || host.startsWith("google.") || host.endsWith(".google.com");

  if (!isGoogleHost) {
    throw new Error("The supplied URL is not a Google search URL.");
  }

  const query = url.searchParams.get("q")?.trim() ?? url.searchParams.get("query")?.trim() ?? "";

  if (!query) {
    throw new Error("The Google URL does not contain a search query.");
  }

  return {
    originalUrl: url.toString(),
    query,
  };
}

export function createImportedImageQueries(query: string): string[] {
  const clean = query.replace(/\s+/g, " ").trim();

  const quoted = `"${clean}"`;

  return [
    clean,
    quoted,
    `${quoted} deepfake`,
    `${quoted} face swap`,
    `${quoted} morphed`,
    `${quoted} AI generated`,
    `${quoted} fake video`,
    `${quoted} fake image`,
    `${quoted} manipulated`,
    `${quoted} impersonation`,
    `${quoted} leaked`,
    `${quoted} explicit fake`,
  ];
}
