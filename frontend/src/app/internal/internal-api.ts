// The operator console's one way to call its same-origin BFF: the passcode
// header on every request, and a failure that keeps the HTTP status and the
// backend's `detail` code, so a panel can tell a refusal (a 4xx, definitive)
// from a lost answer (no status, or a 5xx) without parsing sentences.

export type ApiFailure = Error & { status?: number; detail?: unknown };

export type InternalApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export function failureFrom(response: Response): Promise<ApiFailure> {
  return response.json().catch(() => ({})).then((body: { error?: unknown; detail?: unknown }) => {
    const error = new Error(
      typeof body.error === "string" ? body.error : `Request failed (${response.status}).`,
    ) as ApiFailure;
    error.status = response.status;
    error.detail = body.detail;
    return error;
  });
}

/** The backend's refusal code, when the failure carries one. */
export function failureCode(error: unknown): string | null {
  const detail = (error as ApiFailure | null)?.detail;
  return typeof detail === "string" ? detail : null;
}

export function createInternalApi(passcode: string, fetchImpl?: typeof fetch): InternalApi {
  return async <T,>(path: string, init: RequestInit = {}) => {
    const response = await (fetchImpl ?? fetch)(path, {
      ...init,
      headers: { "x-internal-passcode": passcode, ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (!response.ok) throw await failureFrom(response);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  };
}
