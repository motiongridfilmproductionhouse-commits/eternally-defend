export interface HttpResult {
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
}

export async function lookupHTTP(url: string): Promise<HttpResult> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "Eterna Infrastructure Scanner/1.0",
    },
  });

  const headers: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return {
    status: response.status,
    finalUrl: response.url,
    headers,
  };
}
