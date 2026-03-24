"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Summary = {
  cash_balance_ars: number;
  cash_balance_usd: number;
  pipeline: {
    jobs_done_uninvoiced: number;
    jobs_done_uninvoiced_ha: number;
    billed_uncollected_usd: number;
  };
  commitments: {
    overdue_count: number;
    upcoming_due: { id: number; concept: string; due_date: string; status: string }[];
  };
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

          <div className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <p className="small" style={{ margin: 0, opacity: 0.6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 11 }}>Pipeline</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14 }}>Por cobrar</span>
              <span style={{ fontWeight: 700, fontSize: 16 }}>U$S {fmt(data.pipeline.billed_uncollected_usd, 0)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14 }}>Sin facturar</span>
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {data.pipeline.jobs_done_uninvoiced} trabajo{data.pipeline.jobs_done_uninvoiced !== 1 ? "s" : ""}
                {data.pipeline.jobs_done_uninvoiced_ha > 0 ? ` (${fmt(data.pipeline.jobs_done_uninvoiced_ha, 0)} ha)` : ""}
              </span>
            </div>
          </div>

          {data.commitments.upcoming_due.length > 0 && (
            <div className="card" style={{ padding: "16px 20px" }}>
              <p className="small" style={{ margin: "0 0 12px", opacity: 0.6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 11 }}>
                Próximos vencimientos
                {data.commitments.overdue_count > 0 && (
                  <span style={{ marginLeft: 8, color: "#b42318", fontWeight: 700 }}>· {data.commitments.overdue_count} vencido{data.commitments.overdue_count !== 1 ? "s" : ""}</span>
                )}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.commitments.upcoming_due.slice(0, 4).map((c) => {
                  const isOverdue = c.due_date < new Date().toISOString().slice(0, 10);
                  return (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.concept || `Compromiso #${c.id}`}
                      </span>
                      <span style={{ fontSize: 13, flexShrink: 0, color: isOverdue ? "#b42318" : "var(--muted)", fontWeight: isOverdue ? 600 : 400 }}>
                        {c.due_date}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
