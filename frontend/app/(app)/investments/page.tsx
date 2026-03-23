"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type FxQuote = {
  requested_date: string;
  rate_date: string;
  ars_per_usd: number;
  usd_per_ars: number;
  source: string;
};

type PaymentObligation = {
  id: number;
  source: "MANUAL" | "PURCHASE_INSTALLMENT";
  purchase: number | null;
  status: "PENDING" | "PARTIAL" | "PAID" | "CANCELLED";
};

type Purchase = {
  id: number;
  created_date: string;
  concept: string;
  category: string;
  total_amount: string;
  total_currency: "USD" | "ARS";
  fx_ars_usd: string | null;
  total_amount_usd: string | null;
  total_amount_ars: string | null;
  installment_count: number;
  first_due_date: string | null;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
};

const CATEGORY_OPTIONS = [
  "MAQUINARIA",
  "INSUMOS",
  "SERVICIOS",
  "LOGISTICA",
  "MANTENIMIENTO",
  "TECNOLOGIA",
  "GENERAL",
];

export default function InvestmentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Purchase[]>([]);
  const [obligations, setObligations] = useState<PaymentObligation[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [createdDate, setCreatedDate] = useState(new Date().toISOString().slice(0, 10));
  const [concept, setConcept] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [totalAmount, setTotalAmount] = useState("");
  const [totalCurrency, setTotalCurrency] = useState<"USD" | "ARS">("ARS");
  const [installmentCount, setInstallmentCount] = useState("0");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "COMPLETED" | "CANCELLED">("ACTIVE");
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [sortField, setSortField] = useState<"created_date" | "concept" | "total_amount">("created_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const onSort = (field: "created_date" | "concept" | "total_amount") => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };
  const sortMark = (field: "created_date" | "concept" | "total_amount") => {
    if (sortField !== field) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };
  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const load = async () => {
    const [purchasesData, obligationsData] = await Promise.all([
      apiFetch<Purchase[]>("/purchases/"),
      apiFetch<PaymentObligation[]>("/payment-obligations/"),
    ]);
    setRows(purchasesData);
    setObligations(obligationsData);
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
    Promise.all([load(), loadFxQuote(createdDate)]).catch(() => setError("No se pudo cargar compras"));
  }, [router]);

  useEffect(() => {
    if (!getToken()) return;
    loadFxQuote(createdDate).catch(() => setError("No se pudo obtener tipo de cambio"));
  }, [createdDate]);

  const filteredRows = useMemo(() => {
    const filtered = rows.filter((row) => `${row.concept} ${row.category}`.toLowerCase().includes(search.toLowerCase()));
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "created_date") cmp = a.created_date.localeCompare(b.created_date);
      if (sortField === "concept") cmp = a.concept.localeCompare(b.concept, "es");
      if (sortField === "total_amount") cmp = Number(a.total_amount) - Number(b.total_amount);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, search, sortField, sortDir]);

  const convertedUsd = useMemo(() => {
    if (!fxQuote) return 0;
    const amountNum = Number(totalAmount || 0);
    return totalCurrency === "ARS" ? amountNum * fxQuote.usd_per_ars : amountNum;
  }, [totalAmount, totalCurrency, fxQuote]);

  const convertedArs = useMemo(() => {
    if (!fxQuote) return 0;
    const amountNum = Number(totalAmount || 0);
    return totalCurrency === "USD" ? amountNum * fxQuote.ars_per_usd : amountNum;
  }, [totalAmount, totalCurrency, fxQuote]);

  const resetForm = () => {
    setEditingId(null);
    setCreatedDate(new Date().toISOString().slice(0, 10));
    setConcept("");
    setCategory("GENERAL");
    setTotalAmount("");
    setTotalCurrency("ARS");
    setInstallmentCount("0");
    setFirstDueDate("");
    setStatus("ACTIVE");
    setShowForm(false);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    const payload = {
      created_date: createdDate,
      concept,
      category,
      total_amount: totalAmount,
      total_currency: totalCurrency,
      installment_count: Number(installmentCount || 0),
      first_due_date: Number(installmentCount || 0) > 0 ? firstDueDate : null,
      status,
      notes: "",
    };

    try {
      if (editingId) {
        await apiFetch(`/purchases/${editingId}/`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/purchases/", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      await load();
    } catch {
      setError("No se pudo guardar la compra");
    }
  };

  const onEdit = (row: Purchase) => {
    setShowForm(true);
    setEditingId(row.id);
    setCreatedDate(row.created_date);
    setConcept(row.concept);
    setCategory(row.category || "GENERAL");
    setTotalAmount(row.total_amount);
    setTotalCurrency(row.total_currency);
    setInstallmentCount(String(row.installment_count || 0));
    setFirstDueDate(row.first_due_date || "");
    setStatus(row.status);
  };

  const onDelete = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/purchases/${id}/`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch {
      setError("No se pudo eliminar la compra");
    }
  };

  const statusLabel: Record<Purchase["status"], string> = {
    ACTIVE: "Activa",
    COMPLETED: "Completada",
    CANCELLED: "Cancelada",
  };

  const installmentsByPurchase = useMemo(() => {
    const map: Record<number, { total: number; paid: number }> = {};
    for (const ob of obligations) {
      if (ob.source !== "PURCHASE_INSTALLMENT" || !ob.purchase) continue;
      if (!map[ob.purchase]) map[ob.purchase] = { total: 0, paid: 0 };
      map[ob.purchase].total += 1;
      if (ob.status === "PAID") map[ob.purchase].paid += 1;
    }
    return map;
  }, [obligations]);

  return (
    <section className="card">
      <h2>Compras / Inversiones</h2>
      <p className="small">
        Registrá acá compras grandes o inversiones (ej: maquinaria, equipos, operaciones importantes). Los gastos cotidianos van en
        la sección <strong>Gastos</strong>.
      </p>
      {error ? <p style={{ color: "#b42318", margin: "0 0 10px" }}>{error}</p> : null}

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary" type="button" onClick={() => setShowForm((prev) => !prev)}>
          {showForm ? "Ocultar formulario" : "Nueva compra"}
        </button>
      </div>

      {showForm ? (
        <>
          <h3 style={{ marginTop: 0 }}>{editingId ? "Editar compra" : "Nueva compra"}</h3>
          <form className="form" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
            <div className="ifta-field filled">
              <input type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} required />
              <label>Fecha</label>
            </div>
            <div className={`ifta-field ${concept ? "filled" : ""}`}>
              <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder=" " required />
              <label>Concepto</label>
            </div>
            <div className={`ifta-field ${category ? "filled" : ""}`}>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <label>Categoría</label>
            </div>
            <div className={`ifta-field ${totalAmount ? "filled" : ""}`}>
              <input value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder=" " required />
              <label>Monto total</label>
            </div>
            <div className={`ifta-field ${totalCurrency ? "filled" : ""}`}>
              <select value={totalCurrency} onChange={(e) => setTotalCurrency(e.target.value as "USD" | "ARS")}>
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
              <label>Moneda de carga</label>
            </div>
            <div className={`ifta-field ${fxQuote ? "filled" : ""}`}>
              <input value={fxQuote ? fxQuote.ars_per_usd.toFixed(4) : ""} readOnly placeholder=" " />
              <label>Tipo de cambio ARS/USD</label>
            </div>
            <div className={`ifta-field ${convertedUsd ? "filled" : ""}`}>
              <input value={convertedUsd ? convertedUsd.toFixed(2) : ""} readOnly placeholder=" " />
              <label>Total en USD</label>
            </div>
            <div className={`ifta-field ${convertedArs ? "filled" : ""}`}>
              <input value={convertedArs ? convertedArs.toFixed(2) : ""} readOnly placeholder=" " />
              <label>Total en ARS</label>
            </div>
            <div className={`ifta-field ${status ? "filled" : ""}`}>
              <select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "COMPLETED" | "CANCELLED")}>
                <option value="ACTIVE">Activa</option>
                <option value="COMPLETED">Completada</option>
                <option value="CANCELLED">Cancelada</option>
              </select>
              <label>Estado</label>
            </div>
            <div className={`ifta-field ${installmentCount ? "filled" : ""}`}>
              <input
                type="number"
                min="0"
                step="1"
                value={installmentCount}
                onChange={(e) => setInstallmentCount(e.target.value)}
                placeholder=" "
              />
              <label>Cantidad de cuotas</label>
            </div>
            {Number(installmentCount || 0) > 0 ? (
              <div className={`ifta-field ${firstDueDate ? "filled" : ""}`}>
                <input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} required />
                <label>Primer vencimiento</label>
              </div>
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
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => onSort("created_date")} style={{ cursor: "pointer", userSelect: "none" }}>
                Fecha {sortMark("created_date")}
              </th>
              <th onClick={() => onSort("concept")} style={{ cursor: "pointer", userSelect: "none" }}>
                Concepto {sortMark("concept")}
              </th>
              <th>Categoría</th>
              <th>Estado</th>
              <th>Cuotas</th>
              <th onClick={() => onSort("total_amount")} style={{ cursor: "pointer", userSelect: "none" }}>
                ARS {sortMark("total_amount")}
              </th>
              <th>USD</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id}>
                <td>{row.created_date}</td>
                <td>{row.concept}</td>
                <td>
                  <span className="chip-label">{row.category || "GENERAL"}</span>
                </td>
                <td>
                  <span className={`chip-label chip-status status-${row.status.toLowerCase()}`}>{statusLabel[row.status]}</span>
                </td>
                <td>
                  {row.installment_count > 0 ? (
                    (() => {
                      const stats = installmentsByPurchase[row.id] || { total: row.installment_count, paid: 0 };
                      const total = stats.total || row.installment_count || 1;
                      const paid = stats.paid;
                      const pct = Math.max(0, Math.min(100, (paid / total) * 100));
                      return (
                        <div className="installment-progress">
                          <div className="installment-progress-top">
                            <span>{`${paid}/${total} pagas`}</span>
                            <span>{pct.toFixed(0)}%</span>
                          </div>
                          <div className="installment-progress-bar">
                            <div className="installment-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    "-"
                  )}
                </td>
                <td>{`$${formatNumber(Number(row.total_amount_ars || 0))}`}</td>
                <td>{`U$S ${formatNumber(Number(row.total_amount_usd || 0))}`}</td>
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
