"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Purchase = { id: number; concept: string };
type FxQuote = {
  requested_date: string;
  rate_date: string;
  ars_per_usd: number;
  usd_per_ars: number;
  source: string;
};

type Obligation = {
  id: number;
  concept: string;
  source: "MANUAL" | "PURCHASE_INSTALLMENT";
  purchase: number | null;
  installment_number: number | null;
  installment_total: number | null;
  due_date: string;
  amount: string;
  currency: "USD" | "ARS";
  estimated_amount_usd: string;
  status: "PENDING" | "PARTIAL" | "PAID" | "CANCELLED";
};

export default function CommitmentsPage() {
  const router = useRouter();
  const formAnchorRef = useRef<HTMLDivElement | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [rows, setRows] = useState<Obligation[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [activeRowId, setActiveRowId] = useState<number | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const [concept, setConcept] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "ARS">("ARS");
  const [status, setStatus] = useState<"PENDING" | "PARTIAL" | "PAID" | "CANCELLED">("PENDING");
  const [editingSource, setEditingSource] = useState<"MANUAL" | "PURCHASE_INSTALLMENT">("MANUAL");
  const [editingPurchaseId, setEditingPurchaseId] = useState<number | null>(null);
  const [editingInstallmentNumber, setEditingInstallmentNumber] = useState<number | null>(null);
  const [editingInstallmentTotal, setEditingInstallmentTotal] = useState<number | null>(null);
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [sortField, setSortField] = useState<"due_date" | "concept" | "amount_usd">("due_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const onSort = (field: "due_date" | "concept" | "amount_usd") => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortMark = (field: "due_date" | "concept" | "amount_usd") => {
    if (sortField !== field) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  const purchaseById = useMemo(() => Object.fromEntries(purchases.map((p) => [p.id, p.concept])), [purchases]);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const statusLabel: Record<Obligation["status"], string> = {
    PENDING: "Pendiente",
    PARTIAL: "Parcial",
    PAID: "Pagada",
    CANCELLED: "Cancelada",
  };

  const load = async () => {
    const [purchasesData, rowsData] = await Promise.all([
      apiFetch<Purchase[]>("/purchases/"),
      apiFetch<Obligation[]>("/payment-obligations/"),
    ]);
    setPurchases(purchasesData);
    setRows(rowsData);
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
    Promise.all([load(), loadFxQuote(dueDate)]).catch(() => setError("No se pudo cargar cuentas a pagar"));
  }, [router]);

  useEffect(() => {
    if (!getToken()) return;
    loadFxQuote(dueDate).catch(() => setError("No se pudo obtener tipo de cambio"));
  }, [dueDate]);

  const estimatedUsd = useMemo(() => {
    if (!fxQuote) return 0;
    const amountNum = Number(amount || 0);
    return currency === "ARS" ? amountNum * fxQuote.usd_per_ars : amountNum;
  }, [amount, currency, fxQuote]);

  const resetForm = () => {
    setEditingId(null);
    setEditingSource("MANUAL");
    setEditingPurchaseId(null);
    setEditingInstallmentNumber(null);
    setEditingInstallmentTotal(null);
    setConcept("");
    setDueDate(new Date().toISOString().slice(0, 10));
    setAmount("");
    setCurrency("ARS");
    setStatus("PENDING");
    setShowForm(false);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    try {
      if (editingId) {
        const payload = {
          concept,
          source: editingSource,
          purchase: editingSource === "PURCHASE_INSTALLMENT" ? editingPurchaseId : null,
          installment_number: editingSource === "PURCHASE_INSTALLMENT" ? editingInstallmentNumber : null,
          installment_total: editingSource === "PURCHASE_INSTALLMENT" ? editingInstallmentTotal : null,
          due_date: dueDate,
          amount,
          currency,
          estimated_amount_usd: estimatedUsd.toFixed(2),
          status,
          notes: "",
        };
        await apiFetch(`/payment-obligations/${editingId}/`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        const payload = {
          concept,
          source: "MANUAL",
          purchase: null,
          due_date: dueDate,
          amount,
          currency,
          estimated_amount_usd: estimatedUsd.toFixed(2),
          status,
          notes: "",
        };
        await apiFetch("/payment-obligations/", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la cuenta a pagar");
    }
  };

  const onEdit = (row: Obligation) => {
    setShowForm(true);
    setEditingId(row.id);
    setEditingSource(row.source);
    setEditingPurchaseId(row.purchase);
    setEditingInstallmentNumber(row.installment_number);
    setEditingInstallmentTotal(row.installment_total);
    setConcept(row.concept || "");
    setDueDate(row.due_date);
    setAmount(row.amount);
    setCurrency(row.currency);
    setStatus(row.status);
    requestAnimationFrame(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const onDelete = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/payment-obligations/${id}/`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch {
      setError("No se pudo eliminar la cuenta a pagar");
    }
  };

  const compareRows = (a: Obligation, b: Obligation) => {
    let cmp = 0;
    if (sortField === "due_date") cmp = a.due_date.localeCompare(b.due_date);
    if (sortField === "concept") cmp = a.concept.localeCompare(b.concept, "es");
    if (sortField === "amount_usd") cmp = Number(a.estimated_amount_usd) - Number(b.estimated_amount_usd);
    return sortDir === "asc" ? cmp : -cmp;
  };

  const groupedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const purchaseText = row.purchase ? purchaseById[row.purchase] || "" : "";
      const installmentText =
        row.source === "PURCHASE_INSTALLMENT" && row.installment_number && row.installment_total
          ? `cuota ${row.installment_number}/${row.installment_total}`
          : "";
      const text = `${row.concept} ${purchaseText} ${installmentText} ${row.status}`.toLowerCase();
      return text.includes(search.toLowerCase());
    });

    const groups: Record<string, Obligation[]> = {};
    for (const row of filtered) {
      const monthKey = row.due_date.slice(0, 7);
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(row);
    }

    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((monthKey) => {
        const monthRows = [...groups[monthKey]].sort(compareRows);
        const totalUsd = monthRows.reduce((acc, row) => acc + Number(row.estimated_amount_usd || 0), 0);
        const totalArs = monthRows.reduce((acc, row) => acc + (row.currency === "ARS" ? Number(row.amount || 0) : 0), 0);
        const [year, month] = monthKey.split("-").map(Number);
        const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
        return { monthKey, monthLabel, rows: monthRows, totalUsd, totalArs };
      });
  }, [rows, search, purchaseById, sortField, sortDir]);

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
    <section className="card">
      <h2>Cuentas a pagar</h2>
      <p className="small">Incluye obligaciones manuales y cuotas generadas desde Compras.</p>
      {error ? <p style={{ color: "#b42318", margin: "0 0 10px" }}>{error}</p> : null}

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary" type="button" onClick={() => setShowForm((prev) => !prev)}>
          {showForm ? "Ocultar formulario" : "Nueva cuenta a pagar"}
        </button>
      </div>

      {showForm ? (
        <>
          <div ref={formAnchorRef} />
          <h3 style={{ marginTop: 0 }}>
            {editingId
              ? editingSource === "PURCHASE_INSTALLMENT"
                ? "Editar cuota de compra"
                : "Editar cuenta a pagar manual"
              : "Nueva cuenta a pagar manual"}
          </h3>
          <form className="form" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
            <input id="obligation-concept" name="obligation_concept" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Concepto" required />
            <input id="obligation-due-date" name="obligation_due_date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            <input id="obligation-amount" name="obligation_amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto" required />
            <select id="obligation-currency" name="obligation_currency" value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "ARS")}>
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>
            <input id="obligation-fx" name="obligation_fx" value={fxQuote ? fxQuote.ars_per_usd.toFixed(4) : ""} readOnly placeholder="TC ARS/USD" />
            <input id="obligation-estimated-usd" name="obligation_estimated_usd" value={estimatedUsd ? estimatedUsd.toFixed(2) : ""} readOnly placeholder="USD estimados (auto)" />
            {editingId && editingSource === "PURCHASE_INSTALLMENT" ? (
              <input
                id="obligation-installment-meta"
                name="obligation_installment_meta"
                value={`Compra: ${purchaseById[editingPurchaseId || 0] || editingPurchaseId || "-"} | Cuota ${editingInstallmentNumber || "-"} / ${editingInstallmentTotal || "-"}`}
                readOnly
              />
            ) : null}
            <select id="obligation-status" name="obligation_status" value={status} onChange={(e) => setStatus(e.target.value as "PENDING" | "PARTIAL" | "PAID" | "CANCELLED")}>
              <option value="PENDING">Pendiente</option>
              <option value="PARTIAL">Parcial</option>
              <option value="PAID">Pagada</option>
              <option value="CANCELLED">Cancelada</option>
            </select>
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
        <input id="obligation-search" name="obligation_search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" />
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
                <div className="small">{group.rows.length} obligaciones</div>
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
                      <th onClick={() => onSort("due_date")} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                        Vence {sortMark("due_date")}
                      </th>
                      <th onClick={() => onSort("concept")} style={{ cursor: "pointer", userSelect: "none" }}>
                        Concepto {sortMark("concept")}
                      </th>
                      <th>Tipo</th>
                      <th>ARS</th>
                      <th onClick={() => onSort("amount_usd")} style={{ cursor: "pointer", userSelect: "none" }}>
                        USD {sortMark("amount_usd")}
                      </th>
                      <th>Estado</th>
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
                        <td data-label="Vence" style={{ whiteSpace: "nowrap" }}>{row.due_date}</td>
                        <td data-label="Concepto">
                          <div className="concept-cell">
                            <span className="concept-main">{row.concept || "-"}</span>
                            {row.purchase ? (
                              <div className="concept-subline">
                                {`Compra: ${purchaseById[row.purchase] || row.purchase}${
                                  row.installment_number ? ` (${row.installment_number}/${row.installment_total})` : ""
                                }`}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td data-label="Tipo">
                          {row.source === "PURCHASE_INSTALLMENT" ? <span className="chip-label">Cuota</span> : <span className="chip-label">Manual</span>}
                        </td>
                        <td data-label="ARS">{row.currency === "ARS" ? `$${formatNumber(Number(row.amount || 0))}` : "-"}</td>
                        <td data-label="USD">{`U$S ${formatNumber(Number(row.estimated_amount_usd || 0))}`}</td>
                        <td data-label="Estado">
                          <span className={`chip-label chip-status status-${row.status.toLowerCase()}`}>{statusLabel[row.status]}</span>
                        </td>
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
                                aria-label="Editar cuenta a pagar"
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
                                aria-label="Eliminar cuenta a pagar"
                                disabled={row.source === "PURCHASE_INSTALLMENT"}
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
