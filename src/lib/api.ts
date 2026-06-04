const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const API_URL = configuredApiUrl.replace(/\/$/, "");

function formatResponsePreview(body: string) {
  const preview = body.replace(/\s+/g, " ").trim().slice(0, 160);

  return preview ? ` Body preview: ${preview}` : "";
}

export async function readJsonResponse<T>(
  response: Response,
  action: string
): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `${action} failed (${response.status} ${response.statusText}).${formatResponsePreview(
        body
      )}`
    );
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      `${action} returned ${contentType || "an unknown content type"} instead of JSON.${formatResponsePreview(
        body
      )}`
    );
  }

  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new Error(
      `${action} returned invalid JSON.${formatResponsePreview(body)}`,
      { cause: error }
    );
  }
}
