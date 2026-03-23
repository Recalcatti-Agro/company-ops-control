"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Investor = { id: number; name: string };
type Expense = { id: number; concept: string; date: string };
type FxQuote = {
  requested_date: string;
  rate_date: string;
  ars_per_usd: number;
  usd_per_ars: number;
  source: string;
};
type CashMovement = {
  id: number;
  date: string;
  direction: "IN" | "OUT";
  category:
    | "JOB_COLLECTION"
    | "PROFIT_REINVESTMENT"
    | "CAPITAL_CONTRIBUTION"
    | "CAPITAL_RESCUE"
    | "INVESTOR_WITHDRAWAL"
    | "EXPENSE"
    | "PURCHASE_PAYMENT"
    | "ADJUSTMENT";
  currency: "USD" | "ARS";
  amount_original: string;
  fx_ars_usd: string | null;
  amount_usd: string;
  investor: number | null;
  expense: number | null;
  notes: string;
};

const CATEGORIES = [
  { value: "CAPITAL_CONTRIBUTION", label: "Aporte de capital", direction: "IN", requiresInvestor: true },
  { value: "PROFIT_REINVESTMENT", label: "Reinversión de utilidad", direction: "IN", requiresInvestor: true },
  { value: "CAPITAL_RESCUE", label: "Rescate de capital", direction: "OUT", requiresInvestor: true },
  { value: "INVESTOR_WITHDRAWAL", label: "Retiro de inversor", direction: "OUT", requiresInvestor: true },
  { value: "EXPENSE", label: "Pago de gasto", direction: "OUT", requiresInvestor: false },
  { value: "ADJUSTMENT", label: "Ajuste", direction: "OUT", requiresInvestor: false },
] as const;

export default function CashPage() {
  const router = useRouter();
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rows, setRows] = useState<CashMovement[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("CAPITAL_CONTRIBUTION");
  const [investor, setInvestor] = useState<number | "">("");
  const [expense, setExpense] = useState<number | "">("");
  const [currency, setCurrency] = useState<"USD" | "ARS">("ARS");
  const [amountOriginal, setAmountOriginal] = useState("");
  const [fxArsUsd, setFxArsUsd] = useState("");
  const [notes, setNotes] = useState("");
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const currentCategory = CATEGORIES.find((c) => c.value === category) || CATEGORIES[0];

  const load = async () => {
    const [investorsData, expensesData, rowsData] = await Promise.all([
      apiFetch<Investor[]>("/investors/"),
      apiFetch<Expense[]>("/expenses/"),
      apiFetch<CashMovement[]>("/cash-movements/"),
    ]);
    setInvestors(investorsData);
    setExpenses(expensesData);
    setRows(rowsData);
  };

  const investorById = useMemo(() => Object.fromEntries(investors.map((i) => [i.id, i.name])), [investors]);
  const expenseById = useMemo(
    () => Object.fromEntries(expenses.map((e) => [e.id, `${e.date} - ${e.concept}`])),
    [expenses],
  );

  const investorChipClass = (investorId: number) => `chip-person-${((investorId - 1) % 6) + 1}`;

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const categoryLabel = (value: CashMovement["category"]) => CATEGORIES.find((c) => c.value === value)?.label || value;

  const resetForm = () => {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setCategory("CAPITAL_CONTRIBUTION");
    setInvestor("");
    setExpense("");
    setCurrency("ARS");
    setAmountOriginal("");
    setFxArsUsd("");
    setNotes("");
    setShowForm(false);
  };

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load().catch(() => setError("No se pudo cargar caja"));
  }, [router]);

  useEffect(() => {
    if (!getToken()) return;
    apiFetch<FxQuote>(`/fx/ars-usd/?date=${date}`)
      .then((quote) => {
        setFxQuote(quote);
        if (currency === "ARS") setFxArsUsd(quote.ars_per_usd.toFixed(4));
      })
      .catch(() => setError("No se pudo obtener tipo de cambio"));
  }, [date, currency]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const text = `${row.category} ${row.notes || ""} ${investorById[row.investor || 0] || ""}`.toLowerCase();
      return text.includes(search.toLowerCase());
    });
  }, [rows, search, investorById]);

  const cashBalanceUsd = useMemo(() => {
    return rows.reduce((acc, row) => {
      const amount = Number(row.amount_original || 0);
      if (row.currency !== "USD") return acc;
      return row.direction === "OUT" ? acc - amount : acc + amount;
    }, 0);
  }, [rows]);

  const cashBalanceArs = useMemo(() => {
    return rows.reduce((acc, row) => {
      const amount = Number(row.amount_original || 0);
      if (row.currency !== "ARS") return acc;
      return row.direction === "OUT" ? acc - amount : acc + amount;
    }, 0);
  }, [rows]);

  const convertedUsd = useMemo(() => {
    const amount = Number(amountOriginal || 0);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (currency === "USD") return amount;
    const fx = Number(fxArsUsd || 0);
    if (!Number.isFinite(fx) || fx <= 0) return 0;
    return amount / fx;
  }, [amountOriginal, currency, fxArsUsd]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (currentCategory.requiresInvestor && !investor) {
      setError("Seleccioná inversor para este tipo de movimiento.");
      return;
    }

    const payload = {
      date,
      direction: currentCategory.direction,
      category,
      currency,
      amount_original: amountOriginal,
      fx_ars_usd: currency === "ARS" ? fxArsUsd : null,
      amount_usd: convertedUsd.toFixed(2),
      investor: currentCategory.requiresInvestor ? investor : null,
      expense: category === "EXPENSE" ? expense || null : null,
      notes,
    };

    try {
      if (editingId) {
        await apiFetch(`/cash-movements/${editingId}/`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/cash-movements/", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar movimiento de caja");
    }
  };

  const onEdit = (row: CashMovement) => {
    setShowForm(true);
    setEditingId(row.id);
    setDate(row.date);
    setCategory(row.category as (typeof CATEGORIES)[number]["value"]);
    setInvestor(row.investor ?? "");
    setExpense(row.expense ?? "");
    setCurrency(row.currency || "USD");
    setAmountOriginal(row.amount_original || row.amount_usd);
    setFxArsUsd(row.fx_ars_usd || fxQuote?.ars_per_usd?.toFixed(4) || "");
    setNotes(row.notes || "");
  };

  const onDelete = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/cash-movements/${id}/`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch {
      setError("No se pudo eliminar movimiento de caja");
    }
  };

  return (
    <section className="card">
      <h2>Caja</h2>
      <div className="grid grid-2" style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="small">Caja USD</div>
          <div className="kpi">{`${cashBalanceUsd < 0 ? "-" : ""}U$S ${formatNumber(Math.abs(cashBalanceUsd))}`}</div>
        </div>
        <div className="card">
          <div className="small">Caja ARS</div>
          <div className="kpi">{`${cashBalanceArs < 0 ? "-" : ""}$${formatNumber(Math.abs(cashBalanceArs))}`}</div>
        </div>
      </div>
      <p className="small">Entradas y salidas de caja, incluyendo aportes, reinversiones y retiros.</p>
      {error ? <p style={{ color: "#b42318", margin: "0 0 10px" }}>{error}</p> : null}

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary" type="button" onClick={() => setShowForm((prev) => !prev)}>
          {showForm ? "Ocultar formulario" : "Nuevo movimiento"}
        </button>
      </div>

      {showForm ? (
        <>
          <h3 style={{ marginTop: 0 }}>{editingId ? "Editar movimiento" : "Nuevo movimiento"}</h3>
          <form className="form" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            <select value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number]["value"])}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {currentCategory.requiresInvestor ? (
              <select value={investor} onChange={(e) => setInvestor(e.target.value ? Number(e.target.value) : "")} required>
                <option value="">Seleccionar inversor</option>
                {investors.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.name}
                  </option>
                ))}
              </select>
            ) : null}
            {category === "EXPENSE" ? (
              <select value={expense} onChange={(e) => setExpense(e.target.value ? Number(e.target.value) : "")}> 
                <option value="">Gasto relacionado (opcional)</option>
                {expenses.map((exp) => (
                  <option key={exp.id} value={exp.id}>
                    {expenseById[exp.id]}
                  </option>
                ))}
              </select>
            ) : null}
            <select value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "ARS")}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
            <input value={amountOriginal} onChange={(e) => setAmountOriginal(e.target.value)} placeholder={currency === "ARS" ? "Monto ARS" : "Monto USD"} required />
            {currency === "ARS" ? (
              <input value={fxArsUsd} onChange={(e) => setFxArsUsd(e.target.value)} placeholder="TC ARS/USD" required />
            ) : null}
            <input value={convertedUsd ? convertedUsd.toFixed(2) : ""} readOnly placeholder="Equivalente USD (auto)" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Comentario (opcional)" />
            <div className="row">
              <button className="btn" type="submit">
                {editingId ? "Actualizar" : "Guardar"}
              </button>
              <button className="btn btn-secondary" type="button" onClick={resetForm}>
                Cancelar
              </button>
            </div>
          </form>
        </>
      ) : null}

      <div className="row" style={{ marginBottom: 10 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Inversor</th>
              <th>ARS</th>
              <th>USD</th>
              <th>USD equiv.</th>
              <th>Detalle</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>
                  <span className="chip-label">{categoryLabel(row.category)}</span>
                </td>
                <td>
                  {row.investor ? (
                    <span className={`chip-label chip-person ${investorChipClass(row.investor)}`}>{investorById[row.investor] || row.investor}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{row.currency === "ARS" ? `${row.direction === "OUT" ? "-" : ""}$${formatNumber(Number(row.amount_original || 0))}` : "-"}</td>
                <td>{row.currency === "USD" ? `${row.direction === "OUT" ? "-" : ""}U$S ${formatNumber(Number(row.amount_original || 0))}` : "-"}</td>
                <td>{`${row.direction === "OUT" ? "-" : ""}U$S ${formatNumber(Number(row.amount_usd || 0))}`}</td>
                <td>{row.expense ? expenseById[row.expense] || `Gasto #${row.expense}` : row.notes || "-"}</td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button className="btn btn-secondary" onClick={() => onEdit(row)}>
                      Editar
                    </button>
                    <button className="btn btn-secondary" onClick={() => onDelete(row.id)}>
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
