"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Client = {
  id: number;
  name: string;
  active: boolean;
};

type Job = {
  id: number;
  date: string;
  end_date: string | null;
  client: string;
  hectares: string | null;
  work_type: string;
  status: "PENDING" | "DONE" | "INVOICED" | "COLLECTED" | "CANCELLED";
  notes: string;
};

type FxQuote = {
  requested_date: string;
  rate_date: string;
  ars_per_usd: number;
  usd_per_ars: number;
  source: string;
};

export default function WorksPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Job[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [activeRowId, setActiveRowId] = useState<number | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [selectedClientId, setSelectedClientId] = useState<number | "">("");
  const [newClientName, setNewClientName] = useState("");
  const [hectares, setHectares] = useState("");
  const [workType, setWorkType] = useState("");
  const [notes, setNotes] = useState("");

  const [invoiceMode, setInvoiceMode] = useState(false);
  const [selectedInvoiceJobs, setSelectedInvoiceJobs] = useState<number[]>([]);
  const [invoiceClient, setInvoiceClient] = useState<string | null>(null);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceAmountArs, setInvoiceAmountArs] = useState("");
  const [invoiceAmountUsd, setInvoiceAmountUsd] = useState("");
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);
  const [invoiceFxArsUsd, setInvoiceFxArsUsd] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | Job["status"]>("ALL");
  const [showForm, setShowForm] = useState(false);
  const [sortField, setSortField] = useState<"date" | "client" | "hectares">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = async () => {
    const [jobsData, clientsData] = await Promise.all([apiFetch<Job[]>("/jobs/"), apiFetch<Client[]>("/clients/")]);
    setRows(jobsData);
    setClients(clientsData);
  };

  const loadFxQuote = async (targetDate: string) => {
    const quote = await apiFetch<FxQuote>(`/fx/ars-usd/?date=${targetDate}`);
    setFxQuote(quote);
    setInvoiceFxArsUsd(quote.ars_per_usd.toFixed(4));
  };

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load().catch(() => setError("No se pudo cargar trabajos"));
  }, [router]);

  useEffect(() => {
    if (!getToken()) return;
    loadFxQuote(invoiceDate).catch(() => setError("No se pudo obtener tipo de cambio"));
  }, [invoiceDate]);

  const onSort = (field: "date" | "client" | "hectares") => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortMark = (field: "date" | "client" | "hectares") => {
    if (sortField !== field) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  const resetForm = () => {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setEndDate("");
    setClientMode("existing");
    setSelectedClientId("");
    setNewClientName("");
    setHectares("");
    setWorkType("");
    setNotes("");
    setShowForm(false);
  };

  const resolveClientName = async () => {
    if (clientMode === "existing") {
      if (!selectedClientId) return "";
      return clients.find((c) => c.id === selectedClientId)?.name || "";
    }

    const name = newClientName.trim();
    if (!name) return "";

    const existing = clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.name;

    const created = await apiFetch<Client>("/clients/", {
      method: "POST",
      body: JSON.stringify({ name, active: true, notes: "" }),
    });
    setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "es")));
    setClientMode("existing");
    setSelectedClientId(created.id);
    setNewClientName("");
    return created.name;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    try {
      const resolvedClient = await resolveClientName();
      const payload = {
        date,
        end_date: endDate || null,
        client: resolvedClient,
        hectares: hectares ? Number(hectares) : null,
        work_type: workType,
        notes,
      };

      if (editingId) {
        await apiFetch(`/jobs/${editingId}/`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/jobs/", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      await load();
    } catch {
      setError("No se pudo guardar el trabajo");
    }
  };

  const onEdit = (row: Job) => {
    const existingClient = clients.find((c) => c.name.toLowerCase() === (row.client || "").toLowerCase());

    setShowForm(true);
    setEditingId(row.id);
    setDate(row.date);
    setEndDate(row.end_date || "");
    if (existingClient) {
      setClientMode("existing");
      setSelectedClientId(existingClient.id);
      setNewClientName("");
    } else {
      setClientMode("new");
      setSelectedClientId("");
      setNewClientName(row.client || "");
    }
    setHectares(row.hectares ? String(row.hectares) : "");
    setWorkType(row.work_type || "");
    setNotes(row.notes || "");
  };

  const onDelete = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/jobs/${id}/`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch {
      setError("No se pudo eliminar el trabajo");
    }
  };

  const onMarkDone = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/jobs/${id}/mark-done/`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch {
      setError("No se pudo marcar el trabajo como realizado");
    }
  };

  const onMarkPending = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/jobs/${id}/mark-pending/`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo marcar el trabajo como pendiente");
    }
  };

  const statusLabel: Record<Job["status"], string> = {
    PENDING: "Pendiente",
    DONE: "Realizado",
    INVOICED: "Facturado",
    COLLECTED: "Cobrado",
    CANCELLED: "Cancelado",
  };

  const statusClass: Record<Job["status"], string> = {
    PENDING: "status-pending",
    DONE: "status-completed",
    INVOICED: "status-billed",
    COLLECTED: "status-collected",
    CANCELLED: "status-cancelled",
  };

  const compareRows = (a: Job, b: Job) => {
    let cmp = 0;
    if (sortField === "date") cmp = a.date.localeCompare(b.date);
    if (sortField === "client") cmp = (a.client || "").localeCompare(b.client || "", "es");
    if (sortField === "hectares") cmp = Number(a.hectares || 0) - Number(b.hectares || 0);
    return sortDir === "asc" ? cmp : -cmp;
  };

  const arsAsUsd = useMemo(() => {
    const fx = Number(invoiceFxArsUsd || 0);
    if (!fx || fx <= 0) return 0;
    return Number(invoiceAmountArs || 0) / fx;
  }, [invoiceAmountArs, invoiceFxArsUsd]);

  const onInvoice = async () => {
    if (!selectedInvoiceJobs.length) {
      setError("Seleccioná uno o más trabajos realizados para facturar.");
      return;
    }

    const amountUsd = Number(invoiceAmountUsd || 0) || arsAsUsd;
    if (!amountUsd || amountUsd <= 0) {
      setError("Indicá un monto válido (ARS o USD) para facturar.");
      return;
    }
    const fx = Number(invoiceFxArsUsd || 0);
    if (!fx || fx <= 0) {
      setError("Indicá un tipo de cambio ARS/USD válido.");
      return;
    }

    setError("");
    try {
      await apiFetch("/job-collections/", {
        method: "POST",
        body: JSON.stringify({
          job: selectedInvoiceJobs[0],
          jobs: selectedInvoiceJobs,
          collection_date: invoiceDate,
          amount_ars: invoiceAmountArs || "0",
          fx_ars_usd: fx.toFixed(4),
          amount_usd: amountUsd.toFixed(2),
          status: "BILLED",
          notes: "",
        }),
      });

      setSelectedInvoiceJobs([]);
      setInvoiceAmountArs("");
      setInvoiceAmountUsd("");
      setInvoiceFxArsUsd(fxQuote ? fxQuote.ars_per_usd.toFixed(4) : "");
      setShowInvoiceDialog(false);
      setInvoiceMode(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo facturar");
    }
  };

  const toggleInvoiceSelection = (jobId: number) => {
    const row = rows.find((r) => r.id === jobId);
    if (!row) return;
    setSelectedInvoiceJobs((prev) => {
      const isSelected = prev.includes(jobId);
      if (isSelected) {
        const next = prev.filter((id) => id !== jobId);
        if (!next.length) setInvoiceClient(null);
        return next;
      }
      if (invoiceClient && row.client !== invoiceClient) {
        setError("Solo podés facturar juntos trabajos del mismo cliente.");
        return prev;
      }
      if (!invoiceClient) setInvoiceClient(row.client || "");
      return [...prev, jobId];
    });
  };

  const groupedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const text = `${row.client} ${row.work_type} ${row.notes || ""} ${row.date} ${row.end_date || ""}`.toLowerCase();
      const searchOk = text.includes(search.toLowerCase());
      if (!searchOk) return false;
      const statusOk = statusFilter === "ALL" || row.status === statusFilter;
      if (!statusOk) return false;
      if (!invoiceMode || !invoiceClient) return true;
      const sameClient = (row.client || "") === invoiceClient;
      const notInvoicedOrCollected = row.status !== "INVOICED" && row.status !== "COLLECTED";
      return sameClient && notInvoicedOrCollected;
    });

    const groups: Record<string, Job[]> = {};
    for (const row of filtered) {
      const monthKey = row.date.slice(0, 7);
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(row);
    }

    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((monthKey) => {
        const monthRows = [...groups[monthKey]].sort(compareRows);
        const [year, month] = monthKey.split("-").map(Number);
        const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
        return { monthKey, monthLabel, rows: monthRows };
      });
  }, [rows, search, statusFilter, sortField, sortDir, invoiceMode, invoiceClient]);

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
      <h2>Trabajos</h2>
      <p className="small">Flujo: Pendiente → Realizado → Facturado → Cobrado.</p>
      {error ? <p style={{ color: "#b42318", margin: "0 0 10px" }}>{error}</p> : null}

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary" type="button" onClick={() => setShowForm((prev) => !prev)}>
          {showForm ? "Cerrar diálogo" : "Nuevo trabajo"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => {
            setInvoiceMode((prev) => {
              const next = !prev;
              if (!next) {
                setSelectedInvoiceJobs([]);
                setInvoiceClient(null);
                setShowInvoiceDialog(false);
              }
              return next;
            });
          }}
        >
          {invoiceMode ? "Cancelar facturación" : "Facturar trabajos"}
        </button>
        {invoiceMode ? (
          <button className="btn" type="button" onClick={() => setShowInvoiceDialog(true)} disabled={!selectedInvoiceJobs.length}>
            {`Continuar (${selectedInvoiceJobs.length})`}
          </button>
        ) : null}
      </div>

      {showForm ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={resetForm}
        >
          <div className="card" style={{ width: "min(760px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{editingId ? "Editar trabajo" : "Nuevo trabajo"}</h3>
            <form className="form" onSubmit={onSubmit}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />

              <select
                value={clientMode}
                onChange={(e) => {
                  const mode = e.target.value as "existing" | "new";
                  setClientMode(mode);
                  if (mode === "existing") setNewClientName("");
                  if (mode === "new") setSelectedClientId("");
                }}
              >
                <option value="existing">Cliente existente</option>
                <option value="new">Nuevo cliente</option>
              </select>

              {clientMode === "existing" ? (
                <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Sin cliente</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Nombre del nuevo cliente" />
              )}

              <input value={hectares} onChange={(e) => setHectares(e.target.value)} placeholder="Hectáreas" />
              <input value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="Tipo de trabajo" />
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Aclaraciones (opcional)" />
              <div className="row">
                <button className="btn" type="submit">
                  {editingId ? "Actualizar" : "Guardar"}
                </button>
                <button className="btn btn-secondary" type="button" onClick={resetForm}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="row" style={{ marginBottom: 10 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" />
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          padding: 10,
          border: "1px solid var(--line)",
          borderRadius: 12,
          background: "var(--surface)",
        }}
      >
        <span className="small">Estado:</span>
        {[
          { value: "ALL", label: "Todos", cls: "status-completed" },
          { value: "PENDING", label: "Pendiente", cls: "status-pending" },
          { value: "DONE", label: "Realizado", cls: "status-completed" },
          { value: "INVOICED", label: "Facturado", cls: "status-billed" },
          { value: "COLLECTED", label: "Cobrado", cls: "status-collected" },
          { value: "CANCELLED", label: "Cancelado", cls: "status-cancelled" },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`chip-label ${statusFilter === opt.value ? `chip-status ${opt.cls}` : ""}`}
            onClick={() => setStatusFilter(opt.value as "ALL" | Job["status"])}
            style={{ cursor: "pointer", border: "1px solid var(--line)" }}
          >
            {opt.label}
          </button>
        ))}
        <button className="btn btn-secondary" type="button" onClick={() => setStatusFilter("ALL")} style={{ padding: "8px 10px" }}>
          Limpiar
        </button>
      </div>

      {invoiceMode ? (
        <div className="small" style={{ marginBottom: 10 }}>
          Seleccioná trabajos <strong>Realizados</strong> desde la tabla y luego tocá <strong>Continuar</strong>.
          {invoiceClient ? ` Cliente seleccionado: ${invoiceClient}.` : ""}
        </div>
      ) : null}

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
                <div className="small">{group.rows.length} trabajos</div>
              </div>
            </button>

            {expandedMonths[group.monthKey] ? (
              <div className="table-wrap">
                <table className="mobile-stack-table">
                  <thead>
                    <tr>
                      {invoiceMode ? <th>Facturar</th> : null}
                      <th onClick={() => onSort("date")} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                        Período {sortMark("date")}
                      </th>
                      <th onClick={() => onSort("client")} style={{ cursor: "pointer", userSelect: "none" }}>
                        Cliente {sortMark("client")}
                      </th>
                      <th>Tipo</th>
                      <th onClick={() => onSort("hectares")} style={{ cursor: "pointer", userSelect: "none" }}>
                        Hectáreas {sortMark("hectares")}
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
                        onClick={() => {
                          if (invoiceMode) return;
                          setActiveRowId((prev) => (prev === row.id ? null : row.id));
                        }}
                      >
                        {invoiceMode ? (
                          <td data-label="Facturar">
                            <input
                              type="checkbox"
                              checked={selectedInvoiceJobs.includes(row.id)}
                              disabled={row.status !== "DONE"}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                if (row.status !== "DONE") return;
                                toggleInvoiceSelection(row.id);
                              }}
                            />
                          </td>
                        ) : null}
                        <td data-label="Período" style={{ whiteSpace: "nowrap" }}>
                          {row.end_date ? `${row.date} → ${row.end_date}` : row.date}
                        </td>
                        <td data-label="Cliente">{row.client || "-"}</td>
                        <td data-label="Tipo">
                          <div className="concept-cell">
                            <span className="concept-main">{row.work_type || "-"}</span>
                            {activeRowId === row.id && row.notes ? <div className="concept-subline">{`Aclaraciones: ${row.notes}`}</div> : null}
                          </div>
                        </td>
                        <td data-label="Hectáreas">{row.hectares ? Number(row.hectares).toFixed(2) : "-"}</td>
                        <td data-label="Estado">
                          <span className={`chip-label chip-status ${statusClass[row.status]}`}>
                            {statusLabel[row.status]}
                          </span>
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
                              {row.status === "PENDING" ? (
                                <button
                                  className="action-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onMarkDone(row.id);
                                  }}
                                  title="Marcar realizado"
                                  aria-label="Marcar trabajo como realizado"
                                >
                                  <span>Realizado</span>
                                </button>
                              ) : null}
                              {row.status === "DONE" ? (
                                <button
                                  className="action-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onMarkPending(row.id);
                                  }}
                                  title="Volver a pendiente"
                                  aria-label="Volver trabajo a pendiente"
                                >
                                  <span>Volver pendiente</span>
                                </button>
                              ) : null}
                              <button
                                className="action-btn action-btn-edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEdit(row);
                                }}
                                title="Editar"
                                aria-label="Editar trabajo"
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
                                aria-label="Eliminar trabajo"
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

      {showInvoiceDialog ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={() => setShowInvoiceDialog(false)}
        >
          <div className="card" style={{ width: "min(700px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Facturar trabajos</h3>
            <p className="small">{`Seleccionados: ${selectedInvoiceJobs.length}`}</p>
            <div className="form">
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              <input value={invoiceAmountArs} onChange={(e) => setInvoiceAmountArs(e.target.value)} placeholder="Monto ARS (opcional)" />
              <input value={invoiceAmountUsd} onChange={(e) => setInvoiceAmountUsd(e.target.value)} placeholder="Monto USD (opcional)" />
              <input value={invoiceFxArsUsd} onChange={(e) => setInvoiceFxArsUsd(e.target.value)} placeholder="TC ARS/USD" />
              <input value={arsAsUsd ? arsAsUsd.toFixed(2) : ""} readOnly placeholder="USD desde ARS (auto)" />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="button" onClick={onInvoice}>
                Confirmar facturación
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => setShowInvoiceDialog(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
