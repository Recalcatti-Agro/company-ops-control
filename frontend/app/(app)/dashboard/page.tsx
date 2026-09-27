"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { daysSince, fmtARS, fmtHa, fmtPct, fmtUSD, sumByCurrency } from "@/lib/format";
import MonthlyChart, { type MonthPoint } from "@/components/MonthlyChart";
import { Kpi, PageHeader, ProgressBar } from "@/components/ui";

type Summary = {
  cash_by_account: { name: string; currency: string; balance: string }[];
  cash_total_usd: string;
  total_capital_usd: string;
  cap_table: { investor: string; capital_usd: string; percentage: string }[];
};
type Money = { date: string; amount_original: string; currency: string; fx_ars_usd: string };

// Monto en pesos: si vino en USD se pasa con el tipo de cambio del propio movimiento.
const toArs = (m: Money) => (m.currency === "ARS" ? Number(m.amount_original) : Number(m.amount_original) * Number(m.fx_ars_usd));

export default function DashboardPage() {
  const { session } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/summary/"), api.get("/jobs/"), api.get("/invoices/"),
      api.get("/payments/"), api.get("/expenses/"), api.get("/bills/"),
    ])
      .then(([s, j, i, p, e, b]) => { setData(s); setJobs(j); setInvoices(i); setPayments(p); setExpenses(e); setBills(b); })
      .catch(() => setError("No se pudo cargar el dashboard."));
  }, []);

  // Últimos 12 meses (incluido el actual), aunque alguno no tenga movimientos.
  const monthly: MonthPoint[] = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const sum = (list: Money[], m: string) => list.filter((x) => x.date.startsWith(m)).reduce((acc, x) => acc + toArs(x), 0);
    return months.map((m) => ({ month: m, a: sum(payments, m), b: sum(expenses, m) }));
  }, [payments, expenses]);

  if (error) return <div className="err">{error}</div>;
  if (!data) return <div className="empty">Cargando...</div>;

  const admin = isAdmin(session);
  const toInvoice = jobs.filter((j) => j.status === "PENDING" || j.status === "DONE");
  const openInvoices = invoices.filter((i) => i.status === "OPEN");
  const oldestOpen = openInvoices.length ? Math.max(...openInvoices.map((i) => daysSince(i.date))) : 0;
  const undistributed = payments.filter((p) => Number(p.distributed_usd) <= 0);
  const activeBills = bills.filter((b) => b.status === "PENDING" || b.status === "PARTIAL");
  const overdueBills = activeBills.filter((b) => daysSince(b.due_date) > 0);
  const soonBills = activeBills.filter((b) => { const d = daysSince(b.due_date); return d <= 0 && d >= -7; });

  // Lo que requiere acción. Solo se muestra lo que tiene algo; si no hay nada, "al día".
  const todos = [
    toInvoice.length > 0 && {
      href: "/invoices?tab=to-invoice", label: "Trabajos sin facturar",
      detail: fmtHa(toInvoice.reduce((s, j) => s + Number(j.hectares || 0), 0)), count: toInvoice.length,
    },
    openInvoices.length > 0 && {
      href: "/invoices?tab=open", label: "Facturas por cobrar",
      detail: `${sumByCurrency(openInvoices.map((i) => ({ amount: i.balance_original, currency: i.currency })))} · la más vieja ${oldestOpen} días`,
      count: openInvoices.length, warn: oldestOpen > 30,
    },
    admin && undistributed.length > 0 && {
      href: "/invoices?tab=all", label: "Cobros sin repartir", detail: "Falta aplicar el reparto entre inversores", count: undistributed.length, warn: true,
    },
    overdueBills.length > 0 && {
      href: "/bills", label: "Cuentas vencidas", detail: overdueBills.map((b) => b.concept).slice(0, 2).join(" · "), count: overdueBills.length, warn: true,
    },
    soonBills.length > 0 && {
      href: "/bills", label: "Vencen en los próximos 7 días", detail: soonBills.map((b) => b.concept).slice(0, 2).join(" · "), count: soonBills.length,
    },
  ].filter(Boolean) as { href: string; label: string; detail: string; count: number; warn?: boolean }[];

  const last12 = monthly.reduce((acc, m) => ({ a: acc.a + m.a, b: acc.b + m.b }), { a: 0, b: 0 });

  return (
    <div>
      <PageHeader
        title="Inicio"
        sub={new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Kpi href="/cash" label="Caja total en USD" value={fmtUSD(data.cash_total_usd)} sub="Pesos + dólares, al cambio de hoy" />
        {data.cash_by_account.map((acc) => (
          <Kpi key={acc.name} href="/cash" label={acc.name} value={acc.currency === "ARS" ? fmtARS(acc.balance) : fmtUSD(acc.balance)} />
        ))}
        <Kpi href="/investors" label="Capital total" value={fmtUSD(data.total_capital_usd)} sub={`${data.cap_table.length} inversores activos`} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", marginBottom: 16 }}>
        <div className="card">
          <h2>Para hacer</h2>
          {todos.length === 0 ? (
            <div className="small" style={{ padding: "8px 0" }}>Todo al día: nada por facturar, cobrar ni pagar.</div>
          ) : (
            todos.map((t) => (
              <Link key={t.label} href={t.href} className="todo-item">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.label}</div>
                  <div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.detail}</div>
                </div>
                <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
                  <span className={`todo-count${t.warn ? " overdue" : ""}`}>{t.count}</span>
                  <span className="small">→</span>
                </div>
              </Link>
            ))
          )}
        </div>

        <Link href="/investors" className="card kpi-link">
          <h2>Participación</h2>
          {data.cap_table.map((row) => (
            <div key={row.investor} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 90, fontSize: 12.5, fontWeight: 600, flex: "0 0 auto" }}>{row.investor}</div>
              <ProgressBar pct={Number(row.percentage)} />
              <div className="num" style={{ width: 50, fontSize: 12.5, fontWeight: 700, flex: "0 0 auto" }}>{fmtPct(row.percentage)}</div>
            </div>
          ))}
          {data.cap_table.length === 0 && <div className="empty">Sin inversores activos</div>}
        </Link>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Cobrado vs gastos por mes</h2>
            <div className="small">
              Últimos 12 meses, en pesos · cobrado {fmtARS(last12.a)} · gastos {fmtARS(last12.b)}
            </div>
          </div>
          <div className="legend">
            <span><span className="legend-swatch" style={{ background: "var(--series-1)" }} />Cobrado</span>
            <span><span className="legend-swatch" style={{ background: "var(--series-2)" }} />Gastos</span>
          </div>
        </div>
        <MonthlyChart data={monthly} labelA="Cobrado" labelB="Gastos" />
      </div>
    </div>
  );
}
