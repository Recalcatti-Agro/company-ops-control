"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtARS, fmtDate, fmtUSD } from "@/lib/format";
import { IconPlus } from "@/components/icons";

export default function HomePage() {
  const { session } = useAuth();
  const [data, setData] = useState<any>(null);
  const [myCapital, setMyCapital] = useState<string | null>(null);
  const [bills, setBills] = useState<any[]>([]);

  useEffect(() => {
    api.get("/dashboard/summary/").then(setData);
    api.get("/bills/").then((all) =>
      setBills(all.filter((b: any) => b.status === "PENDING" || b.status === "PARTIAL").slice(0, 3))
    );
    if (session?.role === "INVESTOR") {
      api.get("/investors/cap-table/").then((r) => {
        const mine = r.rows.find((row: any) => row.investor_id === session.investorId);
        if (mine) setMyCapital(mine.capital_usd);
      });
    }
  }, [session]);

  if (!data) return <div className="empty">Cargando...</div>;

  return (
    <div>
      <div className="pageh">
        <div>
          <div className="small">Hola</div>
          <h1>{session?.username}</h1>
        </div>
      </div>

      <div className="quick-row">
        <Link href="/jobs/quick" className="quick-btn btn">
          <IconPlus />
          Nuevo trabajo
        </Link>
        <Link href="/expenses/quick" className="quick-btn btn-secondary">
          <IconPlus />
          Nuevo gasto
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="kpi-label">Caja</div>
        <div className="kpi">{fmtUSD(data.cash_total_usd)}</div>
        {data.cash_by_account.map((a: any) => (
          <div key={a.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0", borderTop: "1px dashed var(--line)" }}>
            <span>{a.name}</span>
            <span style={{ fontWeight: 700 }}>{a.currency === "ARS" ? fmtARS(a.balance) : fmtUSD(a.balance)}</span>
          </div>
        ))}
      </div>

      {myCapital !== null && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="kpi-label">Mi capital</div>
          <div className="kpi">{fmtUSD(myCapital)}</div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="kpi-label">Trabajos</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0" }}>
          <span>Trabajos pendientes</span><span style={{ fontWeight: 700 }}>{data.pipeline.jobs_pending}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0", borderTop: "1px dashed var(--line)" }}>
          <span>Realizados sin facturar</span><span style={{ fontWeight: 700 }}>{data.pipeline.jobs_done_uninvoiced}</span>
        </div>
      </div>

      <div className="card">
        <div className="kpi-label">Próximos vencimientos</div>
        {bills.map((b: any) => (
          <div key={b.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "7px 0", borderTop: "1px dashed var(--line)" }}>
            <span>{b.concept}</span><span style={{ fontWeight: 700 }}>{fmtDate(b.due_date)}</span>
          </div>
        ))}
        {bills.length === 0 && <div className="empty">Sin vencimientos próximos</div>}
      </div>
    </div>
  );
}
