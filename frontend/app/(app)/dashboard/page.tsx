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

  const formatNumber = (value: number, digits = 2) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  const maxMonthly = Math.max(1, ...data.monthly_data.map((item) => Math.max(item.expenses, item.gains)));
  const installmentPct =
    data.commitments.installments_total > 0
      ? (data.commitments.installments_paid / data.commitments.installments_total) * 100
      : 0;

  return (
    <div className="grid" style={{ gap: 16 }}>
      {data.alerts.length ? (
        <section className="card">
          <h2>Alertas</h2>
          <div className="grid" style={{ gap: 8 }}>
            {data.alerts.map((alert, idx) => (
              <div key={`${alert.type}-${idx}`} className="small" style={{ color: "#b42318" }}>
                {alert.message}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid grid-2">
        <section className="card">
          <h2>Caja USD</h2>
          <div className="kpi">U$S {formatNumber(data.cash_balance_usd)}</div>
        </section>

        <section className="card">
          <h2>Caja ARS</h2>
          <div className="kpi">${formatNumber(data.cash_balance_ars)}</div>
        </section>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2>Pipeline de trabajos</h2>
          <div className="small">Pendientes: {data.pipeline.jobs_pending}</div>
          <div className="small">Realizados sin facturar: {data.pipeline.jobs_done_uninvoiced}</div>
          <div className="small">Facturado sin cobrar: {data.pipeline.billed_uncollected_count}</div>
          <div className="small">Monto facturado abierto: ${formatNumber(data.pipeline.billed_uncollected_ars)} · U$S {formatNumber(data.pipeline.billed_uncollected_usd)}</div>
          <div className="small">Cobrado del mes: ${formatNumber(data.pipeline.collected_month_ars)} · U$S {formatNumber(data.pipeline.collected_month_usd_original)}</div>
          <div className="small">Cobrado mes (equiv USD): U$S {formatNumber(data.pipeline.collected_month_usd_equiv)}</div>
        </section>

        <section className="card">
          <h2>Compromisos y cuotas</h2>
          <div className="small">Vencen en 7 días: {data.commitments.due_7_count}</div>
          <div className="small">Vencen en 30 días: {data.commitments.due_30_count}</div>
          <div className="small">Vencidos: {data.commitments.overdue_count}</div>
          <div className="small">Cuotas pagas: {data.commitments.installments_paid}/{data.commitments.installments_total} ({installmentPct.toFixed(0)}%)</div>
          <div className="small" style={{ marginTop: 8 }}>Próximos vencimientos:</div>
          {data.commitments.upcoming_due.length ? (
            data.commitments.upcoming_due.map((item) => (
              <div key={item.id} className="small">
                {item.due_date} · {item.concept || `Compromiso #${item.id}`}
              </div>
            ))
          ) : (
            <div className="small">Sin próximos vencimientos</div>
          )}
        </section>
      </div>

      <div className="grid grid-2">
      <section className="card">
        <h2>Capital accionario</h2>
        <div className="kpi">USD {formatNumber(data.total_capital)}</div>
        <p className="small">Aportes directos + reinversión + gastos pagados por inversor - rescates de capital.</p>
      </section>

      <section className="card">
        <h2>Caja (saldo)</h2>
        <div className="kpi">USD {formatNumber(data.cash_balance)}</div>
        <p className="small">Ingresos de caja menos egresos.</p>
      </section>

      <section className="card">
        <h2>Gastos acumulados</h2>
        <div className="kpi">USD {formatNumber(data.total_expenses)}</div>
      </section>

      <section className="card">
        <h2>Reinversión a caja</h2>
        <div className="kpi">USD {formatNumber(data.total_reinvestments)}</div>
      </section>
      </div>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Cap Table</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Inversor</th>
                <th>Gastos USD</th>
                <th>Reinv. USD</th>
                <th>Directo USD</th>
                <th>Rescate USD</th>
                <th>Aporte USD</th>
                <th>% Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.cap_table.map((row) => (
                <tr key={row.investor_id}>
                  <td>{row.investor_name}</td>
                  <td>{formatNumber(row.expenses_paid_usd)}</td>
                  <td>{formatNumber(row.reinvested_usd)}</td>
                  <td>{formatNumber(row.direct_usd)}</td>
                  <td>{formatNumber(row.withdrawn_usd)}</td>
                  <td>{formatNumber(row.contribution_usd)}</td>
                  <td>{row.percentage.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Gastos vs Ganancia (mensual)</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {data.monthly_data.map((item) => (
            <div key={item.month} style={{ display: "grid", gridTemplateColumns: "80px 1fr", alignItems: "center", gap: 8 }}>
              <span className="small">{item.month}</span>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="small" style={{ width: 70 }}>Gastos</span>
                  <div style={{ height: 8, background: "var(--chart-track)", borderRadius: 999, width: "100%", overflow: "hidden" }}>
                    <div style={{ width: `${(item.expenses / maxMonthly) * 100}%`, height: "100%", background: "#b91c1c" }} />
                  </div>
                  <span className="small">USD {formatNumber(item.expenses, 0)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="small" style={{ width: 70 }}>Ganancia</span>
                  <div style={{ height: 8, background: "var(--chart-track)", borderRadius: 999, width: "100%", overflow: "hidden" }}>
                    <div style={{ width: `${(item.gains / maxMonthly) * 100}%`, height: "100%", background: "#047857" }} />
                  </div>
                  <span className="small">USD {formatNumber(item.gains, 0)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
