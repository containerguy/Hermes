import { ApiError } from "../errors/errors";
import { clearCsrfToken, getCsrfToken, shouldAttachCsrf } from "./csrf";

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const csrfHeader: Record<string, string> = {};
  if (shouldAttachCsrf(url, options)) {
    const token = await getCsrfToken();
    csrfHeader["X-Hermes-CSRF"] = token;
  }

  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeader,
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) {
      clearCsrfToken();
    }
    throw new ApiError({
      code: body.error ?? "request_failed",
      status: response.status,
      body
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

