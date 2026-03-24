"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type DashboardResponse = {
  total_capital: number;
  cash_balance: number;
  cash_balance_ars: number;
  cash_balance_usd: number;
  total_expenses: number;
  total_reinvestments: number;
  pipeline: {
    jobs_pending: number;
    jobs_done_uninvoiced: number;
    billed_uncollected_count: number;
    billed_uncollected_ars: number;
    billed_uncollected_usd: number;
    collected_month_ars: number;
    collected_month_usd_original: number;
    collected_month_usd_equiv: number;
  };
  commitments: {
    due_7_count: number;
    due_30_count: number;
    overdue_count: number;
    installments_total: number;
    installments_paid: number;
    upcoming_due: Array<{
      id: number;
      concept: string;
      due_date: string | null;
      status: "PENDING" | "PARTIAL" | "PAID" | "CANCELLED";
    }>;
  };
  alerts: Array<{ type: string; message: string }>;
  cap_table: Array<{
    investor_id: number;
    investor_name: string;
    expenses_paid_usd: number;
    reinvested_usd: number;
    direct_usd: number;
    withdrawn_usd: number;
    contribution_usd: number;
    percentage: number;
  }>;
  monthly_data: Array<{ month: string; expenses: number; gains: number }>;
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }

    apiFetch<DashboardResponse>("/dashboard/summary/")
      .then(setData)
      .catch((err: Error) => {
        if (err.message.includes("401")) return;
        setError("No se pudo cargar el dashboard");
      });
  }, [router]);

  if (error) return <p>{error}</p>;
  if (!data) return <p>Cargando dashboard...</p>;

  const fmt = (value: number, digits = 2) =>
    new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  const maxMonthly = Math.max(1, ...data.monthly_data.map((item) => Math.max(item.expenses, item.gains)));
  const installmentPct =
    data.commitments.installments_total > 0
      ? (data.commitments.installments_paid / data.commitments.installments_total) * 100
      : 0;

  const monthLabel = (month: string) => {
    const [year, m] = month.split("-");
    return new Date(Number(year), Number(m) - 1, 1)
      .toLocaleDateString("es-AR", { month: "short", year: "2-digit" })
      .replace(".", "")
      .replace(" ", " '");
  };

  return (
    <div className="grid" style={{ gap: 16 }}>

      {/* Alertas */}
      {data.alerts.length ? (
        <section style={{ borderRadius: 12, background: "rgba(185,28,28,0.07)", border: "1px solid rgba(185,28,28,0.2)", padding: "12px 16px", display: "grid", gap: 6 }}>
          {data.alerts.map((alert, idx) => (
            <div key={`${alert.type}-${idx}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "#b91c1c", flexShrink: 0 }}>⚠</span>
              <span className="small" style={{ color: "#b91c1c" }}>{alert.message}</span>
            </div>
          ))}
        </section>
      ) : null}

      {/* Snapshot financiero: caja + posición */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <section className="card">
          <p className="small" style={{ margin: "0 0 4px", opacity: 0.6 }}>Caja USD</p>
          <div className="kpi">U$S {fmt(data.cash_balance_usd)}</div>
        </section>
        <section className="card">
          <p className="small" style={{ margin: "0 0 4px", opacity: 0.6 }}>Caja ARS</p>
          <div className="kpi">$ {fmt(data.cash_balance_ars, 0)}</div>
        </section>
        <section className="card">
          <p className="small" style={{ margin: "0 0 4px", opacity: 0.6 }}>Capital accionario</p>
          <div className="kpi">U$S {fmt(data.total_capital)}</div>
          <p className="small" style={{ margin: "6px 0 0", opacity: 0.45 }}>Aportes + reinv. + gastos − rescates</p>
        </section>
        <section className="card">
          <p className="small" style={{ margin: "0 0 4px", opacity: 0.6 }}>Saldo de caja (equiv. USD)</p>
          <div className="kpi">U$S {fmt(data.cash_balance)}</div>
          <p className="small" style={{ margin: "6px 0 0", opacity: 0.45 }}>Ingresos menos egresos de caja</p>
        </section>
      </div>

      {/* Pipeline + Compromisos */}
      <div className="grid grid-2">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Pipeline</h2>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small" style={{ opacity: 0.7 }}>Pendientes</span>
              <span style={{ fontWeight: 700, fontSize: 18 }}>{data.pipeline.jobs_pending}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small" style={{ opacity: 0.7 }}>Realizados sin facturar</span>
              <span style={{
                fontWeight: 700, fontSize: 18,
                color: data.pipeline.jobs_done_uninvoiced > 0 ? "#b45309" : "inherit"
              }}>{data.pipeline.jobs_done_uninvoiced}</span>
            </div>
            <div style={{ height: 1, background: "var(--line)" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small" style={{ opacity: 0.7 }}>Facturado abierto</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{data.pipeline.billed_uncollected_count} · U$S {fmt(data.pipeline.billed_uncollected_usd, 0)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small" style={{ opacity: 0.7 }}>Cobrado este mes</span>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--primary)" }}>U$S {fmt(data.pipeline.collected_month_usd_equiv, 0)}</span>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Compromisos</h2>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small" style={{ opacity: 0.7 }}>Vencidos</span>
              <span style={{
                fontWeight: 700, fontSize: 18,
                color: data.commitments.overdue_count > 0 ? "#b91c1c" : "inherit"
              }}>{data.commitments.overdue_count}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small" style={{ opacity: 0.7 }}>Vencen en 7 días</span>
              <span style={{
                fontWeight: 700, fontSize: 18,
                color: data.commitments.due_7_count > 0 ? "#b45309" : "inherit"
              }}>{data.commitments.due_7_count}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="small" style={{ opacity: 0.7 }}>Próximos 30 días</span>
              <span style={{ fontWeight: 700, fontSize: 18 }}>{data.commitments.due_30_count}</span>
            </div>
            {data.commitments.installments_total > 0 ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span className="small" style={{ opacity: 0.7 }}>Cuotas pagas</span>
                  <span className="small">{data.commitments.installments_paid}/{data.commitments.installments_total} · {installmentPct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 6, background: "var(--chart-track)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${installmentPct}%`, height: "100%", background: "var(--primary)", borderRadius: 999, transition: "width 0.3s" }} />
                </div>
              </div>
            ) : null}
            {data.commitments.upcoming_due.length > 0 ? (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, display: "grid", gap: 4 }}>
                {data.commitments.upcoming_due.slice(0, 3).map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span className="small" style={{ opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.concept || `Compromiso #${item.id}`}
                    </span>
                    <span className="small" style={{ flexShrink: 0, opacity: 0.6 }}>{item.due_date}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* Gráfico mensual */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Gastos vs Ganancia (mensual)</h2>

        {data.monthly_data.length > 0 ? (() => {
          const totalGains = data.monthly_data.reduce((s, d) => s + d.gains, 0);
          const totalExpenses = data.monthly_data.reduce((s, d) => s + d.expenses, 0);
          const net = totalGains - totalExpenses;
          return (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--line)" }}>
              <div>
                <div className="small" style={{ opacity: 0.6, marginBottom: 2 }}>Ganancia total</div>
                <div style={{ fontWeight: 700, color: "var(--primary)" }}>U$S {fmt(totalGains, 0)}</div>
              </div>
              <div>
                <div className="small" style={{ opacity: 0.6, marginBottom: 2 }}>Gastos total</div>
                <div style={{ fontWeight: 700, color: "#b91c1c" }}>U$S {fmt(totalExpenses, 0)}</div>
              </div>
              <div>
                <div className="small" style={{ opacity: 0.6, marginBottom: 2 }}>Balance neto</div>
                <div style={{ fontWeight: 700, color: net >= 0 ? "var(--primary)" : "#b91c1c" }}>
                  {net >= 0 ? "+" : ""}U$S {fmt(net, 0)}
                </div>
              </div>
            </div>
          );
        })() : null}

        <div style={{ display: "grid", gap: 16 }}>
          {[...data.monthly_data].reverse().map((item) => {
            const net = item.gains - item.expenses;
            return (
              <div key={item.month} style={{ display: "grid", gridTemplateColumns: "56px 1fr auto", alignItems: "center", gap: 12 }}>
                <span className="small" style={{ fontWeight: 600, opacity: 0.75, textTransform: "capitalize" }}>{monthLabel(item.month)}</span>
                <div style={{ display: "grid", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="small" style={{ width: 62, flexShrink: 0, opacity: 0.6 }}>Ganancia</span>
                    <div style={{ height: 12, background: "var(--chart-track)", borderRadius: 999, flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <div style={{ width: `${(item.gains / maxMonthly) * 100}%`, height: "100%", background: "var(--primary)", borderRadius: 999, transition: "width 0.3s" }} />
                    </div>
                    <span className="small" style={{ width: 80, textAlign: "right", flexShrink: 0 }}>{fmt(item.gains, 0)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="small" style={{ width: 62, flexShrink: 0, opacity: 0.6 }}>Gastos</span>
                    <div style={{ height: 12, background: "var(--chart-track)", borderRadius: 999, flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <div style={{ width: `${(item.expenses / maxMonthly) * 100}%`, height: "100%", background: "#b91c1c", borderRadius: 999, transition: "width 0.3s" }} />
                    </div>
                    <span className="small" style={{ width: 80, textAlign: "right", flexShrink: 0 }}>{fmt(item.expenses, 0)}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: net >= 0 ? "var(--primary)" : "#b91c1c",
                  background: net >= 0 ? "rgba(46,94,46,0.1)" : "rgba(185,28,28,0.08)",
                  borderRadius: 6, padding: "2px 7px",
                  whiteSpace: "nowrap", minWidth: 72, textAlign: "center",
                }}>
                  {net >= 0 ? "+" : ""}{fmt(net, 0)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Totales acumulados (contexto contable) */}
      <div className="grid grid-2">
        <section className="card">
          <p className="small" style={{ margin: "0 0 4px", opacity: 0.6 }}>Gastos acumulados</p>
          <div className="kpi" style={{ fontSize: "1.5rem" }}>U$S {fmt(data.total_expenses)}</div>
        </section>
        <section className="card">
          <p className="small" style={{ margin: "0 0 4px", opacity: 0.6 }}>Reinversión a caja</p>
          <div className="kpi" style={{ fontSize: "1.5rem" }}>U$S {fmt(data.total_reinvestments)}</div>
        </section>
      </div>

      {/* Cap Table */}
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h2 style={{ marginTop: 0 }}>Cap Table</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Inversor</th>
                <th style={{ textAlign: "right" }}>Gastos</th>
                <th style={{ textAlign: "right" }}>Reinv.</th>
                <th style={{ textAlign: "right" }}>Directo</th>
                <th style={{ textAlign: "right" }}>Rescate</th>
                <th style={{ textAlign: "right" }}>Aporte</th>
                <th>% Participación</th>
              </tr>
            </thead>
            <tbody>
              {data.cap_table.map((row) => (
                <tr key={row.investor_id}>
                  <td style={{ fontWeight: 600 }}>{row.investor_name}</td>
                  <td style={{ textAlign: "right" }}>{fmt(row.expenses_paid_usd)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(row.reinvested_usd)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(row.direct_usd)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(row.withdrawn_usd)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(row.contribution_usd)}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: "var(--chart-track)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${row.percentage}%`, height: "100%", background: "var(--primary)", borderRadius: 999 }} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 13, minWidth: 42, textAlign: "right" }}>{row.percentage.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
