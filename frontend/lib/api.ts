const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8123/api";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("rc_token");
}

export function setSession(token: string, username: string, role: string, investorId: number | null, userId: number | null) {
  localStorage.setItem("rc_token", token);
  localStorage.setItem("rc_user_id", userId === null ? "" : String(userId));
  localStorage.setItem("rc_username", username);
  localStorage.setItem("rc_role", role);
  localStorage.setItem("rc_investor_id", investorId === null ? "" : String(investorId));
}

export function clearSession() {
  localStorage.removeItem("rc_token");
  localStorage.removeItem("rc_username");
  localStorage.removeItem("rc_role");
  localStorage.removeItem("rc_investor_id");
  localStorage.removeItem("rc_user_id");
}

export function getSession() {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("rc_token");
  if (!token) return null;
  return {
    token,
    username: localStorage.getItem("rc_username") || "",
    role: localStorage.getItem("rc_role") || "INVESTOR",
    userId: localStorage.getItem("rc_user_id") ? Number(localStorage.getItem("rc_user_id")) : null,
    investorId: localStorage.getItem("rc_investor_id")
      ? Number(localStorage.getItem("rc_investor_id"))
      : null,
  };
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(typeof data === "string" ? data : JSON.stringify(data));
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Token ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearSession();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, "No autorizado");
  }

  if (!res.ok) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = res.statusText;
    }
    throw new ApiError(res.status, data);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path: string) => apiFetch(path),
  post: (path: string, body: unknown) => apiFetch(path, { method: "POST", body: JSON.stringify(body) }),
  patch: (path: string, body: unknown) => apiFetch(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: (path: string) => apiFetch(path, { method: "DELETE" }),
};

// Mensaje legible de un error de la API: `detail`, lista de errores o el primer
// error de campo que mande DRF. Si no hay nada útil, el fallback.
export function errorMessage(err: unknown, fallback: string) {
  if (!(err instanceof ApiError)) return fallback;
  const data = err.data as any;
  if (err.status === 403) return "No tenés permiso para hacer esto.";
  if (typeof data === "string" && data) return data;
  if (Array.isArray(data) && data.length) return String(data[0]);
  if (data && typeof data === "object") {
    if (data.detail) return String(data.detail);
    const first = Object.values(data)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
    if (typeof first === "string") return first;
  }
  return fallback;
}
