let csrfToken: string | null = null;
let csrfInFlight: Promise<string> | null = null;

export function clearCsrfToken() {
  csrfToken = null;
  csrfInFlight = null;
}

export function shouldAttachCsrf(url: string, options?: RequestInit) {
  const method = (options?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return false;
  }

  if (!url.startsWith("/api/")) {
    return false;
  }

  const csrfExempt = ["/api/auth/request-code", "/api/auth/verify-code", "/api/auth/register"];
  return !csrfExempt.some((path) => url.startsWith(path));
}

export async function getCsrfToken() {
  if (csrfToken) {
    return csrfToken;
  }

  if (!csrfInFlight) {
    csrfInFlight = fetch("/api/auth/csrf", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("csrf_token_ungueltig");
        }
        return (await response.json()) as { token?: string };
      })
      .then((body) => {
        if (!body.token) {
          throw new Error("csrf_token_ungueltig");
        }
        csrfToken = body.token;
        return body.token;
      })
      .finally(() => {
        csrfInFlight = null;
      });
  }

  return csrfInFlight;
}

export function primeCsrfToken() {
  getCsrfToken().catch(() => undefined);
}

