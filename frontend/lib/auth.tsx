"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearSession, getSession, setSession } from "./api";

type Session = {
  token: string;
  username: string;
  role: string;
  userId: number | null;
  investorId: number | null;
};

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setSessionState(getSession());
    setLoading(false);
  }, []);

  async function login(username: string, password: string) {
    const data = await api.post("/auth/login/", { username, password });
    setSession(data.token, data.username, data.role, data.investor_id, data.user_id ?? null);
    setSessionState(getSession());
  }

  function logout() {
    clearSession();
    setSessionState(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ session, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

export function isAdmin(session: Session | null) {
  return session?.role === "ADMIN";
}

// ADMIN edita todo; INVESTOR solo lo que cargó él (mismo criterio que el backend).
export function canEditOwn(session: Session | null, createdBy: number | null | undefined) {
  if (isAdmin(session)) return true;
  return !!session?.userId && createdBy === session.userId;
}
