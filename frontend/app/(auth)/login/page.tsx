"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
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

  useEffect(() => {
    const prev = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "light");
    return () => {
      if (prev) document.documentElement.setAttribute("data-theme", prev);
      else document.documentElement.removeAttribute("data-theme");
    };
  }, []);

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
      router.push(isMobile ? "/home" : "/dashboard");
    } catch {
      setError("Usuario o contraseña inválidos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card" style={{ maxWidth: 420, margin: "72px auto" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <Image
          src="/logo-login.png"
          alt={COMPANY_NAME}
          width={1480}
          height={297}
          style={{ width: "min(280px, 75%)", height: "auto" }}
          priority
        />
      </div>
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
