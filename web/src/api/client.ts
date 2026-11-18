import { components, paths } from "./schema";

type Schemas = components["schemas"];

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type MeResponse = Schemas["MeResponse"];

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const error = errBody?.error;

    throw new ApiError(
      res.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? `Request failed with status ${res.status}`,
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export type LoginPayload =
  paths["/auth/login"]["post"]["requestBody"]["content"]["application/json"];

export type LoginResponse = Schemas["LoginResponse"];

export function loginRequest(payload: LoginPayload) {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logoutRequest() {
  return apiFetch<{ ok: true }>("/auth/logout", {
    method: "POST",
  });
}

export function fetchMe() {
  return apiFetch<MeResponse>("/me");
}

export type ChangePasswordPayload =
  paths["/auth/change-password"]["post"]["requestBody"]["content"]["application/json"];

export function changePasswordRequest(payload: ChangePasswordPayload) {
  return apiFetch<{ ok: true }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
