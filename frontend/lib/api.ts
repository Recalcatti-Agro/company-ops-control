const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
const TOKEN_KEY = "app_token";
const SESSION_KEY = "app_session";
const decode = (codes: number[]) => String.fromCharCode(...codes);
const TOKEN_KEY_LEGACY = decode([114, 101, 99, 97, 108, 99, 97, 116, 116, 105, 95, 116, 111, 107, 101, 110]);
const SESSION_KEY_LEGACY = decode([114, 101, 99, 97, 108, 99, 97, 116, 116, 105, 95, 115, 101, 115, 115, 105, 111, 110]);

export const getApiUrl = () => API_URL;

type AuthUser = {
  id: number;
  username: string;
  email: string;
};

type AuthSession = {
  user: AuthUser;
  investorId: number | null;
};

export const getToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY_LEGACY);
};

export const setToken = (token: string) => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const setAuthSession = (session: AuthSession) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const getAuthSession = (): AuthSession | null => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY_LEGACY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.user?.id || !parsed?.user?.username) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY_LEGACY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY_LEGACY);
};

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Token ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.replace("/login");
      }
    }

    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (typeof data === "string") message = data;
      else if (data?.detail) message = String(data.detail);
      else if (typeof data === "object") message = JSON.stringify(data);
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
