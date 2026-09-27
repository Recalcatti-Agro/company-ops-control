"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { InvoiceBalance, InvoiceChip } from "@/components/InvoiceStatus";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { daysSince, fmtDate, fmtDateFull, fmtMoney, isPlaceholderClient, sumByCurrency } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import Tabs from "@/components/Tabs";
import InvoiceCreateModal from "@/components/InvoiceCreateModal";
import type { JobRecord } from "@/components/JobForm";
import Link from "next/link";
import { FilterBar, Kpi, PageHeader, SearchInput } from "@/components/ui";

type Invoice = {
  id: number; client: number; client_name: string; date: string; currency: string;
  amount_original: string; collected_original: string; balance_original: string; is_overpaid?: boolean;
  amount_usd: string; collected_usd: string; balance_usd: string; status: string; fx_ars_usd: string;
};
type Payment = {
  id: number; invoice: number; account: number; date: string; amount_original: string; currency: string;
  fx_ars_usd: string; amount_usd: string; tax_loss_usd: string; distributed_usd: string;
};
type Investor = { id: number; name: string; active: boolean };

// Ciclo completo de ingresos: trabajos sin facturar → facturas por cobrar → cobradas.
type TabKey = "to-invoice" | "open" | "paid" | "all";
const TAB_KEYS: TabKey[] = ["to-invoice", "open", "paid", "all"];
const isToInvoice = (j: JobRecord) => j.status === "PENDING" || j.status === "DONE";

export default function InvoicesPage() {
  const { session } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Cobro nuevo: { invoice } · edición: { invoice, payment }
  const [payModal, setPayModal] = useState<{ invoice: Invoice; payment?: Payment } | null>(null);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [deleteInvoice, setDeleteInvoice] = useState<Invoice | null>(null);
  const [deletePayment, setDeletePayment] = useState<{ invoice: Invoice; payment: Payment } | null>(null);
  const [distPayment, setDistPayment] = useState<{ id: number; invoice: Invoice } | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [tab, setTab] = useState<TabKey>("open");
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState("");

  function load() {
    setLoading(true);
    Promise.all([api.get("/invoices/"), api.get("/payments/"), api.get("/jobs/")])
      .then(([inv, pay, j]) => { setInvoices(inv); setPayments(pay); setJobs(j); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  // La pestaña viaja en la URL (?tab=) para poder linkear desde otras pantallas.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("tab") as TabKey | null;
    if (fromUrl && TAB_KEYS.includes(fromUrl)) setTab(fromUrl);
    // ?client= llega desde la ficha de un cliente ("Facturar →").
    if (params.get("client")) setFilterClient(params.get("client")!);
  }, []);

  function changeTab(key: string) {
    setTab(key as TabKey);
    window.history.replaceState(null, "", `/invoices?tab=${key}`);
  }

  // Filtros comunes a todas las pestañas (cliente y búsqueda por nombre de cliente).
  const q = search.trim().toLowerCase();
  const matchClient = (clientId: number, clientName: string) =>
    (!filterClient || String(clientId) === filterClient) && (!q || clientName.toLowerCase().includes(q));
  const jobsToInvoice = useMemo(
    () => jobs.filter((j) => isToInvoice(j) && matchClient(j.client, j.client_name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, filterClient, q],
  );
  const filteredInvoices = invoices.filter((i) => matchClient(i.client, i.client_name));
  const clientOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const i of invoices) byId.set(i.client, i.client_name);
    for (const j of jobs) if (isToInvoice(j)) byId.set(j.client, j.client_name);
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [invoices, jobs]);
  const openInvoices = filteredInvoices.filter((i) => i.status === "OPEN");
  const openTotals = sumByCurrency(openInvoices.map((i) => ({ amount: i.balance_original, currency: i.currency })));
  const oldestOpenDays = openInvoices.length ? Math.max(...openInvoices.map((i) => daysSince(i.date))) : 0;
  const visibleInvoices =
    tab === "open" ? openInvoices : tab === "paid" ? filteredInvoices.filter((i) => i.status !== "OPEN") : filteredInvoices;

  const paymentsByInvoice = useMemo(() => {
    const map = new Map<number, Payment[]>();
    for (const p of payments) {
      if (!map.has(p.invoice)) map.set(p.invoice, []);
      map.get(p.invoice)!.push(p);
    }
    map.forEach((list) => list.sort((a, b) => (a.date < b.date ? -1 : 1)));
    return map;
  }, [payments]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isAdmin = session?.role === "ADMIN";

  return (
    <div>
      <PageHeader title="Facturación" sub="Trabajos por facturar, facturas por cobrar y cobros" />

      {!loading && (
        <Tabs
          active={tab}
          onChange={changeTab}
          tabs={[
            { key: "to-invoice", label: "Por facturar", count: jobsToInvoice.length },
            { key: "open", label: "Por cobrar", count: openInvoices.length },
            { key: "paid", label: "Cobradas", count: filteredInvoices.length - openInvoices.length },
            { key: "all", label: "Todas", count: filteredInvoices.length },
          ]}
        />
      )}

      {!loading && (
        <FilterBar active={!!(search || filterClient)} onClear={() => { setSearch(""); setFilterClient(""); }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar cliente..." />
          <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
            <option value="">Cliente: todos</option>
            {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </FilterBar>
      )}

      {loading ? (
        <div className="empty">Cargando...</div>
      ) : tab === "to-invoice" ? (
        <ToInvoiceView jobs={jobsToInvoice} canInvoice={isAdmin} onInvoiced={() => { load(); }} />
      ) : (
        <>
        {tab === "open" && openInvoices.length > 0 && (
          <div className="kpi-row">
            <Kpi label="Total por cobrar" value={openTotals} />
            <Kpi label="Facturas" value={openInvoices.length} />
            <Kpi label="La más vieja" value={`${oldestOpenDays} días`} tone={oldestOpenDays > 30 ? "warn" : undefined} />
          </div>
        )}
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th></th><th>Cliente</th><th>Fecha</th>
                <th className="num" title="Días desde la fecha de factura (solo las que falta cobrar)">Días</th>
                <th className="num">Monto</th><th className="num">Cobrado</th><th className="num">Saldo</th><th>Estado</th><th></th><th></th>
              </tr>
            </thead>
            <tbody>
              {visibleInvoices.map((inv) => {
                const invPayments = paymentsByInvoice.get(inv.id) || [];
                const open = expanded.has(inv.id);
                const undistributed = invPayments.some((p) => Number(p.distributed_usd) <= 0);
                return (
                  <Fragment key={inv.id}>
                    <tr onClick={() => toggle(inv.id)} style={{ cursor: "pointer" }}>
                      <td className="small">{open ? "▾" : "▸"}</td>
                      <td>
                        <Link href={`/clients/${inv.client}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>{inv.client_name}</Link>
                        {isAdmin && undistributed && <span className="chip c-partial" style={{ marginLeft: 6 }}>Cobro sin repartir</span>}
                      </td>
                      <td>{fmtDate(inv.date)}</td>
                      <td className="num">
                        {inv.status === "OPEN"
                          ? <span className={daysSince(inv.date) > 30 ? "overdue" : undefined}>{daysSince(inv.date)}</span>
                          : <span className="small">—</span>}
                      </td>
                      <td className="num">{fmtMoney(inv.amount_original, inv.currency)}</td>
                      <td className="num">{fmtMoney(inv.collected_original, inv.currency)}</td>
                      <td className="num"><b><InvoiceBalance inv={inv} /></b></td>
                      <td><InvoiceChip inv={inv} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {isAdmin && inv.status === "OPEN" && (
                          <button className="btn-ghost" onClick={() => setPayModal({ invoice: inv })}>Registrar cobro</button>
                        )}
                      </td>
                      <td className="actions">
                        {isAdmin && (
                          <RowActions onEdit={() => setEditInvoice(inv)} onDelete={() => setDeleteInvoice(inv)} />
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ background: "var(--surface)" }}>
                        <td></td>
                        <td colSpan={9} style={{ paddingTop: 4, paddingBottom: 12 }}>
                          <div className="section-label" style={{ marginTop: 6 }}>Cobros ({invPayments.length})</div>
                          {invPayments.length === 0 ? (
                            <div className="small">Todavía sin cobros.</div>
                          ) : (
                            <table>
                              <tbody>
                                {invPayments.map((p) => {
                                  const distributed = Number(p.distributed_usd) > 0;
                                  return (
                                    <tr key={p.id}>
                                      <td style={{ width: 100 }}>{fmtDate(p.date)}</td>
                                      <td>{fmtMoney(p.amount_original, p.currency)}</td>
                                      <td>
                                        {distributed
                                          ? <span className="chip c-paid">Repartido</span>
                                          : <span className="chip c-partial">Sin repartir</span>}
                                      </td>
                                      <td className="actions">
                                        {isAdmin && (
                                          <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                                            <button className="btn-ghost" onClick={() => setDistPayment({ id: p.id, invoice: inv })}>
                                              {distributed ? "Rehacer reparto" : "Repartir"}
                                            </button>
                                            <RowActions
                                              onEdit={() => setPayModal({ invoice: inv, payment: p })}
                                              onDelete={() => setDeletePayment({ invoice: inv, payment: p })}
                                            />
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {visibleInvoices.length === 0 && (
            <div className="empty">
              {search || filterClient ? "No hay facturas con estos filtros." : tab === "open" ? "No hay facturas por cobrar." : "Sin facturas todavía."}
            </div>
          )}
        </div>
        </>
      )}

      {payModal && (
        <PaymentModal
          invoice={payModal.invoice}
          payment={payModal.payment}
          onClose={() => setPayModal(null)}
          onDone={(saved, needsDistribution) => {
            const invoice = payModal.invoice;
            setPayModal(null);
            setExpanded((prev) => new Set(prev).add(invoice.id));
            load();
            if (needsDistribution) setDistPayment({ id: saved.id, invoice });
          }}
        />
      )}

      {editInvoice && (
        <InvoiceEditModal
          invoice={editInvoice}
          onClose={() => setEditInvoice(null)}
          onDone={() => { setEditInvoice(null); load(); }}
        />
      )}

      {deleteInvoice && (
        <ConfirmModal
          title="Borrar factura"
          blocked={(paymentsByInvoice.get(deleteInvoice.id) || []).length > 0}
          onClose={() => setDeleteInvoice(null)}
          onConfirm={async () => { await api.del(`/invoices/${deleteInvoice.id}/`); setDeleteInvoice(null); load(); }}
        >
          ¿Borrar la factura de <b>{deleteInvoice.client_name}</b> del {fmtDate(deleteInvoice.date)} por{" "}
          <b>{fmtMoney(deleteInvoice.amount_original, deleteInvoice.currency)}</b>?
          <div className="small" style={{ marginTop: 6 }}>
            {(paymentsByInvoice.get(deleteInvoice.id) || []).length > 0
              ? "Tiene cobros registrados: hay que borrarlos primero."
              : "Sus trabajos vuelven a quedar como realizados, sin facturar. No se puede deshacer."}
          </div>
        </ConfirmModal>
      )}

      {deletePayment && (
        <ConfirmModal
          title="Borrar cobro"
          onClose={() => setDeletePayment(null)}
          onConfirm={async () => { await api.del(`/payments/${deletePayment.payment.id}/`); setDeletePayment(null); load(); }}
        >
          ¿Borrar el cobro de <b>{fmtMoney(deletePayment.payment.amount_original, deletePayment.payment.currency)}</b> del{" "}
          {fmtDate(deletePayment.payment.date)} ({deletePayment.invoice.client_name})?
          <div className="small" style={{ marginTop: 6 }}>
            Sale de la caja{Number(deletePayment.payment.distributed_usd) > 0 ? " y se borra su reparto (baja el capital de cada inversor)" : ""}.
            La factura vuelve a tener ese saldo pendiente. No se puede deshacer.
          </div>
        </ConfirmModal>
      )}

      {distPayment && (
        <DistributionModal
          payment={distPayment}
          onClose={() => setDistPayment(null)}
          onDone={() => { setDistPayment(null); load(); }}
        />
      )}
    </div>
  );
}

function PaymentModal({
  invoice,
  payment,
  onClose,
  onDone,
}: {
  invoice: Invoice;
  payment?: Payment;
  onClose: () => void;
  onDone: (saved: Payment, needsDistribution: boolean) => void;
}) {
  const [date, setDate] = useState(payment?.date || new Date().toISOString().slice(0, 10));
  const [dateTouched, setDateTouched] = useState(!payment);
  const [amountArs, setAmountArs] = useState(payment ? String(Number(payment.amount_original)) : "");
  const [fx, setFx] = useState(payment?.fx_ars_usd || "");
  const [accounts, setAccounts] = useState<{ id: number; name: string; currency: string }[]>([]);
  const [account, setAccount] = useState(payment ? String(payment.account) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/accounts/").then((accs) => {
      setAccounts(accs);
      if (!payment) {
        const ars = accs.find((a: any) => a.currency === "ARS");
        if (ars) setAccount(String(ars.id));
      }
    });
  }, [payment]);

  useEffect(() => {
    if (!dateTouched) return;
    api.get(`/fx/ars-usd/?date=${date}`).then((r) => setFx(r.ars_per_usd)).catch(() => {});
  }, [date, dateTouched]);

  const currency = payment?.currency || "ARS";
  const amountUsd = currency === "USD"
    ? amountArs
    : amountArs && fx ? (Number(amountArs) / Number(fx)).toFixed(2) : "";
  const wasDistributed = !!payment && Number(payment.distributed_usd) > 0;
  const amountsChanged =
    !!payment && (Number(amountArs) !== Number(payment.amount_original) || Number(fx) !== Number(payment.fx_ars_usd));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload = {
      account: Number(account),
      date,
      amount_original: amountArs,
      currency,
      fx_ars_usd: fx,
      amount_usd: amountUsd,
    };
    try {
      const saved: Payment = payment
        ? await api.patch(`/payments/${payment.id}/`, payload)
        : await api.post("/payments/", { ...payload, invoice: invoice.id });
      // Alta: siempre se reparte. Edición: solo si el backend borró el reparto viejo.
      onDone(saved, !payment || (wasDistributed && Number(saved.distributed_usd) <= 0));
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar el cobro."));
      setSaving(false);
    }
  }

  return (
    <Modal title={`${payment ? "Editar" : "Registrar"} cobro · ${invoice.client_name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {!payment && <div className="small">Saldo pendiente: {fmtMoney(invoice.balance_original, invoice.currency)}</div>}
        <div>
          <label className="field-label">Fecha</label>
          <input type="date" required value={date} onChange={(e) => { setDateTouched(true); setDate(e.target.value); }} />
        </div>
        <div className="grid grid-2">
          <div>
            <label className="field-label">Monto cobrado ({currency})</label>
            <input type="number" step="0.01" required value={amountArs} onChange={(e) => setAmountArs(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Tipo de cambio</label>
            <input type="number" step="0.0001" required value={fx} onChange={(e) => setFx(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="field-label">Cuenta</label>
          <select required value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {currency === "ARS" && amountUsd && <div className="small">≈ USD {amountUsd}</div>}
        {wasDistributed && amountsChanged && (
          <div className="warn-box">
            Cambiaste el monto o el tipo de cambio: el reparto de este cobro se va a borrar y vas a tener que repartirlo de nuevo.
          </div>
        )}
        {error && <div className="err">{error}</div>}
        <button className="btn" type="submit" disabled={saving}>
          {payment ? (wasDistributed && amountsChanged ? "Guardar y volver a repartir" : "Guardar cambios") : "Registrar y repartir"}
        </button>
      </form>
    </Modal>
  );
}

function InvoiceEditModal({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(invoice.date);
  const [amount, setAmount] = useState(String(Number(invoice.amount_original)));
  const [fx, setFx] = useState(invoice.fx_ars_usd);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isArs = invoice.currency === "ARS";
  const amountUsd = isArs ? (amount && fx ? (Number(amount) / Number(fx)).toFixed(2) : "") : amount;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.patch(`/invoices/${invoice.id}/`, { date, amount_original: amount, fx_ars_usd: fx, amount_usd: amountUsd });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar la factura."));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Editar factura · ${invoice.client_name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div>
          <label className="field-label">Fecha de factura</label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid grid-2">
          <div>
            <label className="field-label">Monto ({invoice.currency})</label>
            <input type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Tipo de cambio</label>
            <input type="number" step="0.0001" required value={fx} onChange={(e) => setFx(e.target.value)} />
          </div>
        </div>
        {isArs && amountUsd && <div className="small">≈ USD {amountUsd}</div>}
        <div className="small">El saldo y el estado se recalculan con los cobros que ya tiene.</div>
        {error && <div className="err">{error}</div>}
        <button className="btn" type="submit" disabled={saving}>Guardar cambios</button>
      </form>
    </Modal>
  );
}

function DistributionModal({ payment, onClose, onDone }: { payment: { id: number; invoice: Invoice }; onClose: () => void; onDone: () => void }) {
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [fieldPct, setFieldPct] = useState("0");
  const [workers, setWorkers] = useState<{ investor_id: string; weight: string }[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/investors/").then(setInvestors);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ field_team_percentage: fieldPct || "0" });
    if (workers.some((w) => w.investor_id)) {
      params.set(
        "field_workers",
        JSON.stringify(workers.filter((w) => w.investor_id).map((w) => ({ investor_id: Number(w.investor_id), weight: Number(w.weight || 0) })))
      );
    }
    api.get(`/payments/${payment.id}/distribution-preview/?${params.toString()}`).then(setPreview).catch(() => {});
  }, [fieldPct, workers, payment.id]);

  async function apply() {
    setError("");
    try {
      const params: any = { field_team_percentage: Number(fieldPct || 0) };
      if (workers.some((w) => w.investor_id)) {
        params.field_workers = workers.filter((w) => w.investor_id).map((w) => ({ investor_id: Number(w.investor_id), weight: Number(w.weight || 0) }));
      }
      await api.post(`/payments/${payment.id}/apply-distribution/`, params);
      onDone();
    } catch (err) {
      setError(errorMessage(err, "No se pudo aplicar el reparto."));
    }
  }

  return (
    <Modal title={`Repartir cobro · ${payment.invoice.client_name}`} onClose={onClose}>
      <div className="form">
        <div>
          <label className="field-label">% para equipo de campo</label>
          <input type="number" min="0" max="100" value={fieldPct} onChange={(e) => setFieldPct(e.target.value)} />
        </div>

        {Number(fieldPct) > 0 && (
          <div>
            <label className="field-label">Quiénes trabajaron (peso relativo)</label>
            {workers.map((w, i) => (
              <div className="row" key={i} style={{ marginBottom: 6 }}>
                <select
                  value={w.investor_id}
                  onChange={(e) => setWorkers(workers.map((x, xi) => (xi === i ? { ...x, investor_id: e.target.value } : x)))}
                  style={{ flex: 1 }}
                >
                  <option value="">Inversor...</option>
                  {investors.map((inv) => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                </select>
                <input
                  type="number"
                  placeholder="peso"
                  value={w.weight}
                  onChange={(e) => setWorkers(workers.map((x, xi) => (xi === i ? { ...x, weight: e.target.value } : x)))}
                  style={{ width: 80 }}
                />
              </div>
            ))}
            <button type="button" className="btn-ghost" onClick={() => setWorkers([...workers, { investor_id: "", weight: "" }])}>
              + Agregar
            </button>
          </div>
        )}

        {preview && (
          <div className="card" style={{ background: "var(--surface)" }}>
            <h2>Vista previa</h2>
            {preview.cap_table_date && (
              <div className="small" style={{ marginBottom: 6 }}>
                Parte accionaria según la participación al {fmtDateFull(preview.cap_table_date)} (fin del trabajo)
              </div>
            )}
            {preview.rows.map((r: any) => {
              const inv = investors.find((i) => i.id === r.investor_id);
              return (
                <div key={r.investor_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "5px 0" }}>
                  <span>{inv?.name || r.investor_id}</span>
                  <span>{fmtMoney(r.amount_original, payment.invoice.currency)}</span>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, paddingTop: 10, marginTop: 8, borderTop: "1px solid var(--line)" }}>
              <span>Total distribuido</span>
              <span>{fmtMoney(preview.distributable_original, payment.invoice.currency)}</span>
            </div>
          </div>
        )}

        <div className="small">Todo se reinvierte — sube el capital de cada inversor, no genera movimiento de caja. Si el cobro ya tenía un reparto, se reemplaza.</div>
        {error && <div className="err">{error}</div>}
        <button className="btn" onClick={apply}>Aplicar reparto</button>
      </div>
    </Modal>
  );
}

// Trabajos sin facturar agrupados por cliente: se elige cuáles entran y se factura
// en un paso. Los realizados vienen tildados; los pendientes (todavía no realizados), no.
function ToInvoiceView({ jobs, canInvoice, onInvoiced }: { jobs: JobRecord[]; canInvoice: boolean; onInvoiced: () => void }) {
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [invoicing, setInvoicing] = useState<JobRecord[] | null>(null);

  const byClient = useMemo(() => {
    const groups = new Map<number, JobRecord[]>();
    for (const j of [...jobs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (!groups.has(j.client)) groups.set(j.client, []);
      groups.get(j.client)!.push(j);
    }
    return Array.from(groups.values()).sort((a, b) => a[0].client_name.localeCompare(b[0].client_name, "es"));
  }, [jobs]);

  const isChecked = (j: JobRecord) => j.status === "DONE" ? !unchecked.has(j.id) : unchecked.has(j.id);
  function toggle(j: JobRecord) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(j.id)) next.delete(j.id);
      else next.add(j.id);
      return next;
    });
  }

  if (jobs.length === 0) return <div className="empty">No hay trabajos pendientes de facturar.</div>;

  return (
    <div>
      {byClient.map((clientJobs) => {
        const chosen = clientJobs.filter(isChecked);
        const ha = chosen.reduce((sum, j) => sum + Number(j.hectares || 0), 0);
        return (
          <div className="card table-wrap" key={clientJobs[0].client} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>
                <Link href={`/clients/${clientJobs[0].client}`}>{clientJobs[0].client_name}</Link>
              </h2>
              {canInvoice && isPlaceholderClient(clientJobs[0].client_name) ? (
                // No se factura al cliente comodín: primero hay que asignar el cliente real al trabajo.
                <span className="small overdue">Asigná el cliente real en cada trabajo antes de facturar</span>
              ) : canInvoice && (
                <button className="btn" disabled={chosen.length === 0} onClick={() => setInvoicing(chosen)}>
                  Facturar {chosen.length} trabajo{chosen.length === 1 ? "" : "s"}
                  {ha > 0 ? ` · ${ha.toLocaleString("es-AR", { maximumFractionDigits: 2 })} ha` : ""}
                </button>
              )}
            </div>
            <table>
              <thead><tr>{canInvoice && <th></th>}<th>Fecha</th><th>Tipo</th><th>Ubicación</th><th className="num">Ha</th><th>Estado</th></tr></thead>
              <tbody>
                {clientJobs.map((j) => (
                  <tr key={j.id}>
                    {canInvoice && (
                      <td style={{ width: 32 }}><input type="checkbox" checked={isChecked(j)} onChange={() => toggle(j)} /></td>
                    )}
                    <td style={{ width: 110 }}><Link href={`/jobs/${j.id}`}>{fmtDate(j.date)}</Link></td>
                    <td>{j.work_type_label || "—"}</td>
                    <td>{j.location || "—"}</td>
                    <td className="num">{j.hectares ? Number(j.hectares).toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "—"}</td>
                    <td>
                      {j.status === "DONE"
                        ? <span className="chip c-teal">Realizado</span>
                        : <span className="chip c-pending">Pendiente</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {invoicing && (
        <InvoiceCreateModal
          jobs={invoicing}
          onClose={() => setInvoicing(null)}
          onDone={() => { setInvoicing(null); setUnchecked(new Set()); onInvoiced(); }}
        />
      )}
    </div>
  );
}

