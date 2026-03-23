"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Investor = { id: number; name: string };
type Purchase = { id: number; concept: string };
type Job = { id: number; client: string; work_type: string };
type PaymentObligation = {
  id: number;
  concept: string;
  source: "MANUAL" | "PURCHASE_INSTALLMENT";
  purchase: number | null;
  installment_number: number | null;
  installment_total: number | null;
  due_date: string;
  status: "PENDING" | "PARTIAL" | "PAID" | "CANCELLED";
};
type FxQuote = {
  requested_date: string;
  rate_date: string;
  ars_per_usd: number;
  usd_per_ars: number;
  source: string;
};

type Expense = {
  id: number;
  date: string;
  concept: string;
  amount: string;
  currency: "USD" | "ARS";
  fx_ars_usd: string;
  amount_usd: string;
  paid_by: "INVESTOR" | "CASH";
  payer_investor: number | null;
  purchase: number | null;
  job: number | null;
  payment_obligation: number | null;
};

export default function ExpensesPage() {
  const router = useRouter();
  const formAnchorRef = useRef<HTMLDivElement | null>(null);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [obligations, setObligations] = useState<PaymentObligation[]>([]);
  const [rows, setRows] = useState<Expense[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "ARS">("ARS");
  const [paidBy, setPaidBy] = useState<"INVESTOR" | "CASH">("INVESTOR");
  const [payerInvestor, setPayerInvestor] = useState<number | "">("");
  const [purchase, setPurchase] = useState<number | "">("");
  const [job, setJob] = useState<number | "">("");
  const [paymentObligation, setPaymentObligation] = useState<number | "">("");
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [activeRowId, setActiveRowId] = useState<number | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [sortField, setSortField] = useState<"date" | "concept" | "amount_usd" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const onSort = (field: "date" | "concept" | "amount_usd" | "amount") => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };
  const sortMark = (field: "date" | "concept" | "amount_usd" | "amount") => {
    if (sortField !== field) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  const investorChipClass = (investorId: number | null) => {
    if (!investorId) return "chip-person-cash";
    return `chip-person-${((investorId - 1) % 6) + 1}`;
  };

  const load = async () => {
    const [investorsData, purchasesData, jobsData, obligationsData, expensesData] = await Promise.all([
      apiFetch<Investor[]>("/investors/"),
      apiFetch<Purchase[]>("/purchases/"),
      apiFetch<Job[]>("/jobs/"),
      apiFetch<PaymentObligation[]>("/payment-obligations/"),
      apiFetch<Expense[]>("/expenses/"),
    ]);
    setInvestors(investorsData);
    setPurchases(purchasesData);
    setJobs(jobsData);
    setObligations(obligationsData);
    setRows(expensesData);
  };

  const loadFxQuote = async (targetDate: string) => {
    const quote = await apiFetch<FxQuote>(`/fx/ars-usd/?date=${targetDate}`);
    setFxQuote(quote);
  };

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    Promise.all([load(), loadFxQuote(date)]).catch(() => setError("No se pudo cargar gastos"));
  }, [router]);

  useEffect(() => {
    if (!getToken()) return;
    loadFxQuote(date).catch(() => setError("No se pudo obtener tipo de cambio"));
  }, [date]);

  const investorById = useMemo(() => Object.fromEntries(investors.map((i) => [i.id, i.name])), [investors]);
  const obligationById = useMemo(() => Object.fromEntries(obligations.map((o) => [o.id, o])), [obligations]);

  const convertedUsd = useMemo(() => {
    if (!fxQuote) return 0;
    const amountNum = Number(amount || 0);
    return currency === "ARS" ? amountNum * fxQuote.usd_per_ars : amountNum;
  }, [amount, currency, fxQuote]);

  const convertedArs = useMemo(() => {
    if (!fxQuote) return 0;
    const amountNum = Number(amount || 0);
    return currency === "USD" ? amountNum * fxQuote.ars_per_usd : amountNum;
  }, [amount, currency, fxQuote]);

  const resetForm = () => {
    setEditingId(null);
    const today = new Date().toISOString().slice(0, 10);
    setDate(today);
    setConcept("");
    setAmount("");
    setCurrency("ARS");
    setPaidBy("INVESTOR");
    setPayerInvestor("");
    setPurchase("");
    setJob("");
    setPaymentObligation("");
    setShowForm(false);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (paidBy === "INVESTOR" && !payerInvestor) {
      setError("Seleccioná qué inversor pagó.");
      return;
    }

    setError("");
    const payload = {
      date,
      concept,
      amount,
      currency,
      paid_by: paidBy,
      payer_investor: paidBy === "INVESTOR" ? payerInvestor : null,
      purchase: purchase || null,
      job: job || null,
      payment_obligation: paymentObligation || null,
      notes: "",
    };

    try {
      if (editingId) {
        await apiFetch(`/expenses/${editingId}/`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/expenses/", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el gasto");
    }
  };

  const onEdit = (row: Expense) => {
    setShowForm(true);
    setEditingId(row.id);
    setDate(row.date);
    setConcept(row.concept);
    setAmount(row.amount);
    setCurrency(row.currency);
    setPaidBy(row.paid_by);
    setPayerInvestor(row.payer_investor ?? "");
    setPurchase(row.purchase ?? "");
    setJob(row.job ?? "");
    setPaymentObligation(row.payment_obligation ?? "");
    requestAnimationFrame(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const onDelete = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/expenses/${id}/`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch {
      setError("No se pudo eliminar el gasto");
    }
  };

  const purchaseById = useMemo(() => Object.fromEntries(purchases.map((p) => [p.id, p.concept])), [purchases]);
  const jobById = useMemo(
    () => Object.fromEntries(jobs.map((j) => [j.id, `${j.client || "Sin cliente"} - ${j.work_type || `Trabajo #${j.id}`}`])),
    [jobs]
  );
  const obligationsByPurchase = useMemo(() => {
    const map: Record<number, PaymentObligation[]> = {};
    for (const o of obligations) {
      if (!o.purchase) continue;
      if (!map[o.purchase]) map[o.purchase] = [];
      map[o.purchase].push(o);
    }
    return map;
  }, [obligations]);
  const manualObligations = useMemo(() => obligations.filter((o) => !o.purchase), [obligations]);
  const selectedObligations = useMemo(() => {
    if (purchase) return obligationsByPurchase[purchase] || [];
    return manualObligations;
  }, [purchase, obligationsByPurchase, manualObligations]);

  const compareRows = (a: Expense, b: Expense) => {
    let cmp = 0;
    if (sortField === "date") cmp = a.date.localeCompare(b.date);
    if (sortField === "concept") cmp = a.concept.localeCompare(b.concept, "es");
    if (sortField === "amount") cmp = Number(a.amount) - Number(b.amount);
    if (sortField === "amount_usd") cmp = Number(a.amount_usd) - Number(b.amount_usd);
    return sortDir === "asc" ? cmp : -cmp;
  };

  const groupedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const payerText = row.payer_investor ? investorById[row.payer_investor] || "" : "Caja";
      const purchaseText = row.purchase ? purchaseById[row.purchase] || "" : "";
      const jobText = row.job ? jobById[row.job] || "" : "";
      return `${row.concept} ${payerText} ${purchaseText} ${jobText}`.toLowerCase().includes(search.toLowerCase());
    });
    const groups: Record<string, Expense[]> = {};
    for (const row of filtered) {
      const monthKey = row.date.slice(0, 7);
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(row);
    }
    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((monthKey) => {
        const monthRows = [...groups[monthKey]].sort(compareRows);
        const totalUsd = monthRows.reduce((acc, row) => acc + Number(row.amount_usd), 0);
        const totalArs = monthRows.reduce(
          (acc, row) =>
            acc + (row.currency === "ARS" ? Number(row.amount) : Number(row.amount) * Number(row.fx_ars_usd || 0)),
          0,
        );
        const [year, month] = monthKey.split("-").map(Number);
        const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
        return { monthKey, monthLabel, rows: monthRows, totalUsd, totalArs };
      });
  }, [rows, search, investorById, purchaseById, jobById, sortField, sortDir]);

  useEffect(() => {
    setExpandedMonths((prev) => {
      const next: Record<string, boolean> = {};
      for (const group of groupedRows) {
        if (prev[group.monthKey] !== undefined) next[group.monthKey] = prev[group.monthKey];
      }
      if (Object.keys(next).length === 0 && groupedRows.length > 0) {
        next[groupedRows[0].monthKey] = true;
      }
      return next;
    });
  }, [groupedRows]);

  return (
    <section className="card">
      <h2>Gastos</h2>
      <p className="small">
        Registrá acá egresos reales ya pagados. Si es una compra/inversión grande, cargala en <strong>Compras</strong>.
      </p>
      {error ? <p style={{ color: "#b42318", margin: "0 0 10px" }}>{error}</p> : null}

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary" type="button" onClick={() => setShowForm((prev) => !prev)}>
          {showForm ? "Ocultar formulario" : "Nuevo gasto"}
        </button>
      </div>

      {showForm ? (
        <>
          <div ref={formAnchorRef} />
          <h3 style={{ marginTop: 0 }}>{editingId ? "Editar gasto" : "Nuevo gasto"}</h3>
          <form className="form" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Concepto" required />
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto" required />
            <select value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "ARS")}>
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>

            <input value={fxQuote ? fxQuote.ars_per_usd.toFixed(4) : ""} readOnly placeholder="Tipo de cambio ARS/USD (auto)" />
            <input value={convertedUsd ? convertedUsd.toFixed(2) : ""} readOnly placeholder="Equivalente USD (auto)" />
            <input value={convertedArs ? convertedArs.toFixed(2) : ""} readOnly placeholder="Equivalente ARS (auto)" />

            <select value={paidBy} onChange={(e) => setPaidBy(e.target.value as "INVESTOR" | "CASH")}>
              <option value="INVESTOR">Lo paga inversor</option>
              <option value="CASH">Sale de caja</option>
            </select>
            {paidBy === "CASH" ? <div className="small">Este gasto se registra como salida de caja automáticamente.</div> : null}

            <select
              value={purchase}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : "";
                setPurchase(v);
                setPaymentObligation("");
              }}
            >
              <option value="">Sin compra asociada</option>
              {purchases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.concept}
                </option>
              ))}
            </select>
            <select value={job} onChange={(e) => setJob(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Sin trabajo asociado</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {jobById[j.id] || `Trabajo #${j.id}`}
                </option>
              ))}
            </select>

            <select
              value={paymentObligation}
              onChange={(e) => {
                const value = e.target.value ? Number(e.target.value) : "";
                setPaymentObligation(value);
                if (!value) return;
                const obligation = obligations.find((o) => o.id === value);
                if (obligation?.purchase) setPurchase(obligation.purchase);
              }}
            >
              <option value="">Sin compromiso asociado</option>
              {selectedObligations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.source === "PURCHASE_INSTALLMENT"
                    ? `Cuota ${o.installment_number}/${o.installment_total} - ${purchaseById[o.purchase || 0] || "Compra"}`
                    : o.concept || `Obligación #${o.id}`}{" "}
                  - vence {o.due_date} ({o.status})
                </option>
              ))}
            </select>

            {paidBy === "INVESTOR" ? (
              <select value={payerInvestor} onChange={(e) => setPayerInvestor(e.target.value ? Number(e.target.value) : "")} required>
                <option value="">Seleccionar inversor</option>
                {investors.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.name}
                  </option>
                ))}
              </select>
            ) : null}

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
      <div className="accordion-list">
        {groupedRows.map((group) => (
          <section className="month-accordion" key={group.monthKey}>
            <button
              className="month-accordion-header"
              onClick={() => setExpandedMonths((prev) => ({ ...prev, [group.monthKey]: !prev[group.monthKey] }))}
              type="button"
            >
              <div>
                <strong style={{ textTransform: "capitalize" }}>{group.monthLabel}</strong>
                <div className="small">{group.rows.length} movimientos</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div>{`$${formatNumber(group.totalArs)}`}</div>
                <div>{`U$S ${formatNumber(group.totalUsd)}`}</div>
              </div>
            </button>
            {expandedMonths[group.monthKey] ? (
              <div className="table-wrap">
                <table className="mobile-stack-table">
                  <thead>
                    <tr>
                      <th onClick={() => onSort("date")} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                        Fecha {sortMark("date")}
                      </th>
                      <th onClick={() => onSort("concept")} style={{ cursor: "pointer", userSelect: "none" }}>
                        Concepto {sortMark("concept")}
                      </th>
              <th>Obligación</th>
                      <th>Quién pagó</th>
                      <th>ARS</th>
                      <th onClick={() => onSort("amount_usd")} style={{ cursor: "pointer", userSelect: "none" }}>
                        USD {sortMark("amount_usd")}
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr
                        key={row.id}
                        className={`row-clickable ${activeRowId === row.id ? "row-active" : ""}`}
                        onClick={() => setActiveRowId((prev) => (prev === row.id ? null : row.id))}
                      >
                        <td data-label="Fecha" style={{ whiteSpace: "nowrap" }}>{row.date}</td>
                        <td data-label="Concepto">
                          <div className="concept-cell">
                            <span className="concept-main">{row.concept}</span>
                            {row.purchase ? (
                              <div className="concept-subline">{`Compra: ${purchaseById[row.purchase] || row.purchase}`}</div>
                            ) : null}
                            {row.job ? <div className="concept-subline">{`Trabajo: ${jobById[row.job] || row.job}`}</div> : null}
                          </div>
                        </td>
                        <td data-label="Obligación">
                          {row.payment_obligation
                            ? obligationById[row.payment_obligation]?.source === "PURCHASE_INSTALLMENT"
                              ? `Cuota ${obligationById[row.payment_obligation]?.installment_number}/${obligationById[row.payment_obligation]?.installment_total}`
                              : obligationById[row.payment_obligation]?.concept || `#${row.payment_obligation}`
                            : "-"}
                        </td>
                        <td data-label="Quién pagó">
                          <span
                            className={`chip-label chip-person ${
                              row.paid_by === "CASH" ? "chip-person-cash" : investorChipClass(row.payer_investor)
                            }`}
                          >
                            {row.paid_by === "CASH" ? "Caja" : investorById[row.payer_investor || 0] || row.payer_investor}
                          </span>
                        </td>
                        <td data-label="ARS">
                          {`$${formatNumber(
                            row.currency === "ARS" ? Number(row.amount) : Number(row.amount) * Number(row.fx_ars_usd || 0),
                          )}`}
                        </td>
                        <td data-label="USD">{`U$S ${formatNumber(Number(row.amount_usd))}`}</td>
                        <td data-label="Acciones">
                          <div className="row" style={{ justifyContent: "flex-end", alignItems: "center" }}>
                            <button
                              className="row-more-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveRowId((prev) => (prev === row.id ? null : row.id));
                              }}
                              title="Acciones"
                              aria-label="Mostrar acciones"
                            >
                              ⋯
                            </button>
                            <div className={`row-actions ${activeRowId === row.id ? "is-open" : ""}`}>
                              <button
                                className="action-btn action-btn-edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEdit(row);
                                }}
                                title="Editar"
                                aria-label="Editar gasto"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.8" />
                                  <path d="M13 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                                </svg>
                                <span>Editar</span>
                              </button>
                              <button
                                className="action-btn action-btn-delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(row.id);
                                }}
                                title="Eliminar"
                                aria-label="Eliminar gasto"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M5 7h14" fill="none" stroke="currentColor" strokeWidth="1.8" />
                                  <path d="M9 7V5h6v2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                                  <path d="M8 7l1 12h6l1-12" fill="none" stroke="currentColor" strokeWidth="1.8" />
                                </svg>
                                <span>Eliminar</span>
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}
