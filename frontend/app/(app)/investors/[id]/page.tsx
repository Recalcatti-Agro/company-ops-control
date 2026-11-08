"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Tabs from "@/components/Tabs";
import { api } from "@/lib/api";
import { fmtDate, fmtMoney, fmtPct, fmtUSD } from "@/lib/format";
import { FilterBar, Kpi, PageHeader, PeriodFilter, SearchInput } from "@/components/ui";

type Movement = {
  id: number | string;
  date: string;
  kind: "CONTRIBUTION" | "RESCUE" | "JOB_DISTRIBUTION" | "EXPENSE_PAID";
  amount_original: string;
  currency: string;
  amount_usd: string;
  concept?: string;
  payment_client_name?: string | null;
  payment_job_label?: string | null;
  notes?: string;
};

const KIND: Record<Movement["kind"], { label: string; chip: string }> = {
  JOB_DISTRIBUTION: { label: "Reparto", chip: "c-paid" },
  EXPENSE_PAID: { label: "Gasto pagado", chip: "c-teal" },
  CONTRIBUTION: { label: "Aporte", chip: "c-open" },
  RESCUE: { label: "Rescate", chip: "c-danger" },
};

const PAGE = 100;

// Lo que suma o resta al capital, en USD (los rescates restan).
const signedUsd = (m: Movement) => (m.kind === "RESCUE" ? -1 : 1) * Number(m.amount_usd);

function detailOf(m: Movement) {
  if (m.kind === "JOB_DISTRIBUTION") {
    return [m.payment_client_name, m.payment_job_label].filter(Boolean).join(" · ") || "Cobro";
  }
  return m.concept || m.notes || "—";
}

export default function InvestorDetailPage() {
  const params = useParams();
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [capRow, setCapRow] = useState<{ name: string; capital_usd: string; percentage: string } | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"all" | Movement["kind"]>("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    Promise.all([api.get(`/investors/${params.id}/capital-events/`), api.get("/investors/cap-table/")])
      .then(([events, cap]) => {
        setMovements(events);
        setCapRow(cap.rows.find((r: any) => String(r.investor_id) === String(params.id)) || null);
      })
      .catch(() => setError(true));
  }, [params.id]);

  // Capital acumulado después de cada movimiento (sobre la lista completa, sin filtros).
  const runningById = useMemo(() => {
    const acc = new Map<Movement["id"], number>();
    let total = 0;
    // La API los manda del más nuevo al más viejo: se recorren al revés para que,
    // en un mismo día, el de arriba sea el que deja el acumulado final.
    [...(movements || [])]
      .reverse()
      .forEach((m) => { total += signedUsd(m); acc.set(m.id, total); });
    return acc;
  }, [movements]);

  useEffect(() => setLimit(PAGE), [tab, search, from, to]);

  if (error) {
    return (
      <div className="empty">
        No se pudo cargar el detalle. <Link href="/investors" style={{ textDecoration: "underline" }}>Volver a Inversores</Link>
      </div>
    );
  }
  if (!movements) return <div className="empty">Cargando...</div>;

  const name = capRow?.name || "Inversor";
  const byKind = (k: Movement["kind"]) => movements.filter((m) => m.kind === k);
  const usdOf = (list: Movement[]) => list.reduce((a, m) => a + Number(m.amount_usd), 0);
  const distributions = byKind("JOB_DISTRIBUTION");
  const expenses = byKind("EXPENSE_PAID");
  const contributions = byKind("CONTRIBUTION");
  const rescues = byKind("RESCUE");

  const q = search.trim().toLowerCase();
  const filtered = movements.filter((m) =>
    (tab === "all" || m.kind === tab)
    && (!from || m.date >= from)
    && (!to || m.date <= to)
    && (!q || detailOf(m).toLowerCase().includes(q)),
  );
  const filteredTotal = filtered.reduce((a, m) => a + signedUsd(m), 0);
  const filtersActive = tab !== "all" || !!search || !!from || !!to;

  const tabs = [
    { key: "all", label: "Todos", count: movements.length },
    { key: "JOB_DISTRIBUTION", label: "Repartos", count: distributions.length },
    { key: "EXPENSE_PAID", label: "Gastos pagados", count: expenses.length },
    ...(contributions.length ? [{ key: "CONTRIBUTION", label: "Aportes", count: contributions.length }] : []),
    ...(rescues.length ? [{ key: "RESCUE", label: "Rescates", count: rescues.length }] : []),
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ href: "/investors", label: "Inversores" }]}
        title={name}
        sub="Movimientos que forman el capital"
      />

      <div className="kpi-row">
        <Kpi
          label="Capital"
          value={fmtUSD(capRow?.capital_usd ?? 0)}
          sub={capRow ? `Participación ${fmtPct(capRow.percentage)}` : undefined}
        />
        <Kpi
          label="Repartos de cobros"
          value={fmtUSD(usdOf(distributions))}
          sub={`${distributions.length} movimiento${distributions.length === 1 ? "" : "s"}`}
        />
        <Kpi
          label="Gastos pagados"
          value={fmtUSD(usdOf(expenses))}
          sub={`${expenses.length} gasto${expenses.length === 1 ? "" : "s"} de su bolsillo`}
        />
        {(contributions.length > 0 || rescues.length > 0) && (
          <Kpi
            label="Aportes − rescates"
            value={fmtUSD(usdOf(contributions) - usdOf(rescues))}
            sub={`${contributions.length} aporte${contributions.length === 1 ? "" : "s"} · ${rescues.length} rescate${rescues.length === 1 ? "" : "s"}`}
          />
        )}
      </div>

      <FilterBar active={filtersActive} onClear={() => { setTab("all"); setSearch(""); setFrom(""); setTo(""); }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar concepto o cliente..." />
        <PeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </FilterBar>

      <div className="card table-wrap">
        <Tabs tabs={tabs} active={tab} onChange={(k) => setTab(k as typeof tab)} />
        {filtered.length === 0 ? <div className="empty">Sin movimientos para estos filtros.</div> : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th><th>Tipo</th><th>Detalle</th>
                  <th className="num">Monto</th><th className="num">USD</th><th className="num">Capital acumulado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((m) => (
                  <tr key={m.id}>
                    <td style={{ width: 90 }}>{fmtDate(m.date)}</td>
                    <td><span className={`chip ${KIND[m.kind]?.chip || "c-pending"}`} style={{ whiteSpace: "nowrap" }}>{KIND[m.kind]?.label || m.kind}</span></td>
                    <td>{detailOf(m)}</td>
                    <td className="num">{fmtMoney(m.amount_original, m.currency)}</td>
                    <td className="num">{m.kind === "RESCUE" ? "−" : ""}{fmtUSD(m.amount_usd)}</td>
                    <td className="num small">{fmtUSD(runningById.get(m.id) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}><b>{filtersActive ? "Total filtrado" : "Total"}</b> <span className="small">· {filtered.length} movimiento{filtered.length === 1 ? "" : "s"}</span></td>
                  <td className="num"><b>{fmtUSD(filteredTotal)}</b></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            {filtered.length > limit && (
              <div style={{ padding: 12, textAlign: "center" }}>
                <button className="btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>
                  Mostrar más ({filtered.length - limit} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
