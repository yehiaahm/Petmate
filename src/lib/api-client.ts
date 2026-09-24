"use client";

/**
 * Browser API client.
 *
 * Every mutating call carries the CSRF token from the cookie, so no component
 * has to remember. Errors arrive as a typed `ApiError` with the field-level
 * detail the server produced, which is what lets forms highlight the right box
 * instead of showing one generic banner.
 */

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: FieldError[];
  readonly meta?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    status: number,
    fields: FieldError[] = [],
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.meta = meta;
  }

  fieldError(name: string): string | undefined {
    return this.fields.find((f) => f.field === name || f.field.endsWith(`.${name}`))?.message;
  }

  get isValidation() {
    return this.code === "VALIDATION_ERROR" || this.code === "UNPROCESSABLE";
  }
  get isAuth() {
    return this.code === "UNAUTHENTICATED";
  }
  get needsUpgrade() {
    return this.code === "UPGRADE_REQUIRED";
  }
}

function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)pm_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Multipart uploads pass a FormData body and must not set Content-Type. */
  formData?: FormData;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? (options.body || options.formData ? "POST" : "GET");
  const headers: Record<string, string> = {};

  if (method !== "GET") {
    const token = readCsrfToken();
    if (token) headers["x-csrf-token"] = token;
  }

  if (options.body !== undefined && !options.formData) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      signal: options.signal,
      body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    // A failed fetch is almost always the network, not the server.
    throw new ApiError(
      "We could not reach PetMate. Check your connection and try again.",
      "NETWORK",
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; fields?: FieldError[]; meta?: Record<string, unknown> } } | null)?.error;
    throw new ApiError(
      error?.message ?? "Something went wrong. Please try again.",
      error?.code ?? "INTERNAL",
      response.status,
      error?.fields ?? [],
      error?.meta,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: "GET", signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "DELETE", body }),
  upload: <T>(path: string, formData: FormData) => apiRequest<T>(path, { method: "POST", formData }),
};

/** Builds a query string, skipping empty values so URLs stay clean and cacheable. */
export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(","));
    } else {
      search.set(key, String(value));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}
