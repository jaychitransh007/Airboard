import { AIRBOARD_API_URL } from "./config.ts";

export class AirboardApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
  ) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "AirboardApiError";
  }
}

export async function airboardApi<T>(
  path: string,
  options: RequestInit & { accessToken?: string | null } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.accessToken) headers.set("Authorization", `Bearer ${options.accessToken}`);
  let response: Response;
  try {
    response = await fetch(new URL(path, AIRBOARD_API_URL), {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new AirboardApiError("NETWORK_UNAVAILABLE", 0);
  }
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try {
      code = String(((await response.json()) as { error?: unknown }).error ?? code);
    } catch {
      // Keep the HTTP fallback for non-JSON edge responses.
    }
    throw new AirboardApiError(code, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
