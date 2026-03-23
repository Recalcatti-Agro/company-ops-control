"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, setAuthSession, setToken } from "@/lib/api";
import { COMPANY_NAME } from "@/lib/brand";

type LoginResponse = {
  token: string;
  user: { id: number; username: string; email: string };
  investor_id: number | null;
};

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await apiFetch<LoginResponse>("/auth/login/", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(data.token);
      setAuthSession({ user: data.user, investorId: data.investor_id });
      const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
      router.push(isMobile ? "/expenses/quick" : "/dashboard");
    } catch {
      setError("Usuario o contraseña inválidos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card" style={{ maxWidth: 420, margin: "72px auto" }}>
      <h1>Ingreso</h1>
      <p className="small">Administración {COMPANY_NAME}</p>
      <form className="form" onSubmit={onSubmit}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Usuario" required />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Contraseña"
          required
        />
        {error ? <p style={{ color: "#b42318", margin: 0 }}>{error}</p> : null}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Ingresando..." : "Entrar"}
        </button>
      </form>
    </section>
  );
}
