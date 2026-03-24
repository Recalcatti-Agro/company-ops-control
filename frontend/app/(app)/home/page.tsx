"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Summary = {
  cash_balance_ars: number;
  cash_balance_usd: number;
};

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    apiFetch<Summary>("/dashboard/summary/")
      .then(setData)
      .catch(() => setError("No se pudo cargar"));
  }, [router]);

  const fmt = (n: number, decimals = 2) =>
    new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);

  return (
    <section style={{ maxWidth: 400, margin: "0 auto", padding: "24px 0" }}>
      {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}

      {!data ? (
        <p className="small" style={{ textAlign: "center" }}>Cargando...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ textAlign: "center", padding: "24px 20px" }}>
            <p className="small" style={{ margin: "0 0 6px", opacity: 0.6 }}>Caja ARS</p>
            <p style={{ margin: 0, fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.5px" }}>
              $ {fmt(data.cash_balance_ars, 0)}
            </p>
          </div>

          <div className="card" style={{ textAlign: "center", padding: "24px 20px" }}>
            <p className="small" style={{ margin: "0 0 6px", opacity: 0.6 }}>Caja USD</p>
            <p style={{ margin: 0, fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.5px" }}>
              U$S {fmt(data.cash_balance_usd)}
            </p>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <Link href="/expenses/quick" className="btn" style={{ flex: 1, textAlign: "center" }}>
              Nuevo gasto
            </Link>
            <Link href="/works/quick" className="btn btn-secondary" style={{ flex: 1, textAlign: "center" }}>
              Nuevo trabajo
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
