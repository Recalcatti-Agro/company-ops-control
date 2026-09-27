"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { canEditOwn, useAuth } from "@/lib/auth";
import { capitalize, fmtARS, fmtDate, fmtMoney, fmtUSD } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import { ExpenseForm, type ExpenseRecord } from "@/components/ExpenseForm";
import { IconPlus } from "@/components/icons";
import { FilterBar, PageHeader, PeriodFilter, SearchInput } from "@/components/ui";

type Expense = ExpenseRecord;
type Account = { id: number; name: string };
type Investor = { id: number; name: string };

export default function ExpensesPage() {
  const { session } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [loading, setLoading] = useState(true);
  // null = cerrado · "new" = alta · Expense = edición
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [search, setSearch] = useState("");
  const [filterPayer, setFilterPayer] = useState(""); // "" · "CASH" · id de inversor
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const hasFilters = !!(search || filterPayer || dateFrom || dateTo);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

  function load() {
    setLoading(true);
    Promise.all([api.get("/expenses/"), api.get("/accounts/"), api.get("/investors/")])
      .then(([e, a, i]) => { setExpenses(e); setAccounts(a); setInvestors(i); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const investorById = useMemo(() => Object.fromEntries(investors.map((i) => [i.id, i.name])), [investors]);

  function payerName(e: Expense) {
    return e.paid_by === "CASH" ? "Caja" : investorById[e.investor || 0] || "Inversor";
  }

  function arsEquivalent(e: Expense) {
    return e.currency === "ARS" ? Number(e.amount_original) : Number(e.amount_original) * Number(e.fx_ars_usd || 0);
  }

  const groupedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = expenses.filter((e) => {
      if (filterPayer === "CASH" && e.paid_by !== "CASH") return false;
      if (filterPayer && filterPayer !== "CASH" && String(e.investor) !== filterPayer) return false;
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      if (!q) return true;
      return `${e.concept} ${payerName(e)}`.toLowerCase().includes(q);
    });
    const groups: Record<string, Expense[]> = {};
    for (const e of filtered) {
      const monthKey = e.date.slice(0, 7);
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(e);
    }
    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((monthKey) => {
        const rows = [...groups[monthKey]].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        const totalArs = rows.reduce((acc, e) => acc + arsEquivalent(e), 0);
        const totalUsd = rows.reduce((acc, e) => acc + Number(e.amount_usd || 0), 0);
        const [year, month] = monthKey.split("-").map(Number);
        const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
        return { monthKey, monthLabel, rows, totalArs, totalUsd };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, search, filterPayer, dateFrom, dateTo, investorById]);

  const filteredCount = groupedRows.reduce((n, g) => n + g.rows.length, 0);
  const filteredTotalArs = groupedRows.reduce((n, g) => n + g.totalArs, 0);

  useEffect(() => {
    setExpandedMonths((prev) => {
      const next: Record<string, boolean> = {};
      for (const group of groupedRows) {
        if (prev[group.monthKey] !== undefined) next[group.monthKey] = prev[group.monthKey];
      }
      if (Object.keys(next).length === 0 && groupedRows.length > 0) next[groupedRows[0].monthKey] = true;
      return next;
    });
  }, [groupedRows]);

  return (
    <div>
      <PageHeader
        title="Gastos"
        sub={`${hasFilters ? `${filteredCount} de ${expenses.length} gastos` : `${expenses.length} gastos`} · ${fmtARS(filteredTotalArs)}`}
        actions={<button className="btn" onClick={() => setEditing("new")}><IconPlus size={16} /> Nuevo gasto</button>}
      />

      <FilterBar active={hasFilters} onClear={() => { setSearch(""); setFilterPayer(""); setDateFrom(""); setDateTo(""); }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar (concepto...)" />
        <select value={filterPayer} onChange={(e) => setFilterPayer(e.target.value)}>
          <option value="">Quién pagó: todos</option>
          <option value="CASH">Caja</option>
          {investors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <PeriodFilter from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
      </FilterBar>

      {loading ? <div className="empty">Cargando...</div> : (
        <div style={{ display: "grid", gap: 12 }}>
          {groupedRows.map((group) => {
            // Con filtros activos se abren todos los meses para ver los resultados.
            const isOpen = hasFilters || !!expandedMonths[group.monthKey];
            return (
              <div className="card" key={group.monthKey} style={{ padding: 0, overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setExpandedMonths((prev) => ({ ...prev, [group.monthKey]: !prev[group.monthKey] }))}
                  style={{
                    width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: 16, background: "transparent", border: 0, cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div>
                    <strong>{isOpen ? "▾ " : "▸ "}{capitalize(group.monthLabel)}</strong>
                    <div className="small">{group.rows.length} movimientos</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{fmtARS(group.totalArs)}</div>
                    <div className="small">{fmtUSD(group.totalUsd)}</div>
                  </div>
                </button>

                {isOpen && (
                  <div className="table-wrap" style={{ borderTop: "1px solid var(--line)" }}>
                    <table>
                      <thead>
                        <tr><th>Fecha</th><th>Concepto</th><th>Quién pagó</th><th style={{ textAlign: "right" }}>ARS</th><th style={{ textAlign: "right" }}>USD</th><th></th></tr>
                      </thead>
                      <tbody>
                        {group.rows.map((e) => (
                          <tr key={e.id}>
                            <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.date)}</td>
                            <td>{e.concept}</td>
                            <td>{payerName(e)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtARS(arsEquivalent(e))}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtUSD(Number(e.amount_usd || 0))}</td>
                            <td className="actions">
                              {canEditOwn(session, e.created_by) && (
                                <RowActions onEdit={() => setEditing(e)} onDelete={() => setDeleting(e)} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {groupedRows.length === 0 && <div className="empty">{hasFilters ? "No hay gastos con estos filtros." : "Sin gastos todavía."}</div>}
        </div>
      )}

      {editing && (
        <Modal title={editing === "new" ? "Nuevo gasto" : "Editar gasto"} onClose={() => setEditing(null)}>
          <ExpenseForm
            expense={editing === "new" ? null : editing}
            accounts={accounts}
            investors={investors}
            onSaved={() => { setEditing(null); load(); }}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar gasto"
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(`/expenses/${deleting.id}/`); setDeleting(null); load(); }}
        >
          ¿Borrar <b>{deleting.concept}</b> del {fmtDate(deleting.date)} por <b>{fmtMoney(deleting.amount_original, deleting.currency)}</b>?
          <div className="small" style={{ marginTop: 6 }}>
            {deleting.paid_by === "CASH" ? "El monto vuelve a sumar en la caja." : "Se descuenta del capital del inversor que lo pagó."} No se puede deshacer.
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}
