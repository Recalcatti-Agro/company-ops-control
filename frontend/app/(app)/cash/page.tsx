"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtARS, fmtDate, fmtUSD } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import { IconPlus } from "@/components/icons";
import { CardHead, FilterBar, PageHeader, PeriodFilter } from "@/components/ui";
import Tabs from "@/components/Tabs";

type Account = { id: number; name: string; currency: string; balance: string };
type CapitalEvent = {
  id: number; date: string; investor: number; investor_name: string; notes: string; kind: string; amount_original: string;
  currency: string; amount_usd: string; fx_ars_usd: string; account: number | null; payment: number | null;
  payment_client_name: string | null; payment_job_label: string | null;
};
type Payment = {
  id: number; date: string; client_name: string; amount_original: string; currency: string;
  amount_usd: string; fx_ars_usd: string; account: number;
};
type Expense = {
  id: number; date: string; concept: string; amount_original: string; currency: string;
  amount_usd: string; fx_ars_usd: string; paid_by: string; account: number | null;
};
type Investor = { id: number; name: string };
type Transfer = {
  id: number; date: string; from_account: number; from_account_name: string;
  to_account: number; to_account_name: string; amount_from: string; amount_to: string; notes: string;
};

const KIND_LABEL: Record<string, string> = { CONTRIBUTION: "Aporte", RESCUE: "Rescate", JOB_DISTRIBUTION: "Reparto" };

// La línea de color es siempre la moneda real de la operación — así se ve de un
// vistazo a qué caja (ARS o USD) afectó. La gris es solo la referencia en la otra.
function moneyCell(currency: string, amountOriginal: string | number, amountUsd: string | number, fxArsUsd: string | number, negative: boolean) {
  const sign = negative ? "−" : "+";
  const color = negative ? "var(--text)" : "var(--primary)";
  const isArs = currency === "ARS";
  const primary = isArs ? fmtARS(amountOriginal) : fmtUSD(amountOriginal);
  const fx = Number(fxArsUsd);
  const secondary = isArs ? fmtUSD(amountUsd) : fx > 0 ? fmtARS(Number(amountUsd) * fx) : null;
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ color, fontWeight: 700, whiteSpace: "nowrap" }}>
        {sign} {primary}
      </div>
      {secondary && (
        <div className="small" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{secondary}</div>
      )}
    </div>
  );
}

type MovementType = "cobro" | "gasto" | "aporte" | "rescate" | "transferencia";

const TYPE_SINGULAR: Record<MovementType, string> = {
  cobro: "Cobro", gasto: "Gasto", aporte: "Aporte", rescate: "Rescate", transferencia: "Transferencia",
};

// Monto de un movimiento expresado en la moneda de la cuenta que afecta.
function inAccountCurrency(accountCurrency: string | undefined, m: { currency: string; amount_original: string; amount_usd: string; fx_ars_usd: string }) {
  if (!accountCurrency || accountCurrency === m.currency) return Number(m.amount_original);
  return accountCurrency === "USD" ? Number(m.amount_usd) : Number(m.amount_usd) * Number(m.fx_ars_usd);
}

const TYPE_LABEL: Record<MovementType, string> = {
  cobro: "Cobros", gasto: "Gastos", aporte: "Aportes", rescate: "Rescates", transferencia: "Transferencias",
};

type LedgerRow = {
  key: string;
  date: string;
  type: MovementType;
  // Cuánto cambia cada cuenta con este movimiento, en la moneda de la cuenta.
  deltas: Record<number, number>;
  currency: string;
  accountIds: number[];
  label: React.ReactNode;
  amountCell: React.ReactNode;
  distributionId?: number;
  distributionRows?: CapitalEvent[];
  onEdit?: () => void;
  onDelete?: () => void;
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyEventForm = () => ({ date: today(), investor: "", kind: "CONTRIBUTION", amount_original: "", currency: "ARS", fx_ars_usd: "", account: "", notes: "" });
const emptyTransferForm = () => ({ date: today(), from_account: "", to_account: "", amount_from: "", amount_to: "", notes: "" });

const PAGE_SIZE = 20;

export default function CashPage() {
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<CapitalEvent[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyEventForm());
  const [transferForm, setTransferForm] = useState(emptyTransferForm());
  const [transferError, setTransferError] = useState("");
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [editingTransferId, setEditingTransferId] = useState<number | null>(null);
  const [eventDateTouched, setEventDateTouched] = useState(false);
  const [deleting, setDeleting] = useState<{ path: string; title: string; text: React.ReactNode } | null>(null);
  const isAdmin = session?.role === "ADMIN";
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [typeFilter, setTypeFilter] = useState<MovementType | "">("");
  const [accountFilter, setAccountFilter] = useState("");
  const accountDefaulted = useRef(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const distributionsByPayment = useMemo(() => {
    const map = new Map<number, CapitalEvent[]>();
    for (const e of events) {
      if (e.kind === "JOB_DISTRIBUTION" && e.payment) {
        if (!map.has(e.payment)) map.set(e.payment, []);
        map.get(e.payment)!.push(e);
      }
    }
    return map;
  }, [events]);

  const fullLedger = useMemo(() => {
    const rows: LedgerRow[] = [];
    const accountCurrency = new Map(accounts.map((a) => [a.id, a.currency]));
    for (const p of payments) {
      const distributionRows = distributionsByPayment.get(p.id);
      rows.push({
        key: `payment-${p.id}`,
        date: p.date,
        type: "cobro",
        currency: p.currency,
        label: (
          <>
            {p.client_name}
            {distributionRows && <span className="small"> · {distributionRows[0].payment_job_label || "trabajo"}</span>}
          </>
        ),
        deltas: { [p.account]: inAccountCurrency(accountCurrency.get(p.account), p) },
        amountCell: moneyCell(p.currency, p.amount_original, p.amount_usd, p.fx_ars_usd, false),
        accountIds: [p.account],
        distributionId: distributionRows ? p.id : undefined,
        distributionRows,
      });
    }
    for (const e of expenses) {
      if (e.paid_by !== "CASH") continue;
      rows.push({
        key: `expense-${e.id}`,
        date: e.date,
        type: "gasto",
        currency: e.currency,
        label: <>{e.concept}</>,
        deltas: e.account ? { [e.account]: -inAccountCurrency(accountCurrency.get(e.account), e) } : {},
        amountCell: moneyCell(e.currency, e.amount_original, e.amount_usd, e.fx_ars_usd, true),
        accountIds: e.account ? [e.account] : [],
      });
    }
    for (const ev of events) {
      if (ev.kind === "JOB_DISTRIBUTION") continue;
      rows.push({
        key: `capital-${ev.id}`,
        date: ev.date,
        type: ev.kind === "RESCUE" ? "rescate" : "aporte",
        currency: ev.currency,
        label: <>{ev.investor_name}{ev.notes && <span className="small"> · {ev.notes}</span>}</>,
        deltas: ev.account
          ? { [ev.account]: (ev.kind === "RESCUE" ? -1 : 1) * inAccountCurrency(accountCurrency.get(ev.account), ev) }
          : {},
        amountCell: moneyCell(ev.currency, ev.amount_original, ev.amount_usd, ev.fx_ars_usd, ev.kind === "RESCUE"),
        accountIds: ev.account ? [ev.account] : [],
        onEdit: isAdmin ? () => openEditEvent(ev) : undefined,
        onDelete: isAdmin
          ? () => setDeleting({
              path: `/capital-events/${ev.id}/`,
              title: `Borrar ${KIND_LABEL[ev.kind].toLowerCase()}`,
              text: (
                <>
                  ¿Borrar el {KIND_LABEL[ev.kind].toLowerCase()} de <b>{ev.investor_name}</b> del {fmtDate(ev.date)} por{" "}
                  <b>{ev.currency === "ARS" ? fmtARS(ev.amount_original) : fmtUSD(ev.amount_original)}</b>?
                  <div className="small" style={{ marginTop: 6 }}>Cambia el saldo de la caja y el capital del inversor. No se puede deshacer.</div>
                </>
              ),
            })
          : undefined,
      });
    }
    for (const t of transfers) {
      const fromCurrency = accountCurrency.get(t.from_account) || "ARS";
      const toCurrency = accountCurrency.get(t.to_account) || "USD";
      rows.push({
        key: `transfer-${t.id}`,
        date: t.date,
        type: "transferencia",
        currency: fromCurrency,
        label: <>{t.from_account_name} → {t.to_account_name}{t.notes && <span className="small"> · {t.notes}</span>}</>,
        deltas: { [t.from_account]: -Number(t.amount_from), [t.to_account]: Number(t.amount_to) },
        amountCell: (
          <div style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
            <span>
              − {fromCurrency === "ARS" ? fmtARS(t.amount_from) : fmtUSD(t.amount_from)}
            </span>
            {" → "}
            <span style={{ color: "var(--primary)" }}>
              + {toCurrency === "ARS" ? fmtARS(t.amount_to) : fmtUSD(t.amount_to)}
            </span>
          </div>
        ),
        accountIds: [t.from_account, t.to_account],
        onEdit: isAdmin ? () => openEditTransfer(t) : undefined,
        onDelete: isAdmin
          ? () => setDeleting({
              path: `/transfers/${t.id}/`,
              title: "Borrar transferencia",
              text: (
                <>
                  ¿Borrar la transferencia del {fmtDate(t.date)} de <b>{t.from_account_name}</b> a <b>{t.to_account_name}</b>?
                  <div className="small" style={{ marginTop: 6 }}>Se revierte en el saldo de las dos cuentas. No se puede deshacer.</div>
                </>
              ),
            })
          : undefined,
      });
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, expenses, events, transfers, accounts, distributionsByPayment, isAdmin]);

  const runningBalance = useMemo(() => {
    const map = new Map<string, number>();
    const account = accounts.find((a) => String(a.id) === accountFilter);
    if (!account) return map;
    let balance = Number(account.balance);
    for (const row of fullLedger) {
      const delta = row.deltas[account.id];
      if (delta === undefined) continue;
      map.set(row.key, balance); // saldo después de este movimiento
      balance -= delta;
    }
    return map;
  }, [fullLedger, accounts, accountFilter]);
  const selectedAccount = accounts.find((a) => String(a.id) === accountFilter);

  const ledger = useMemo(() => {
    return fullLedger.filter((row) => {
      if (typeFilter && row.type !== typeFilter) return false;
      if (accountFilter && !row.accountIds.includes(Number(accountFilter))) return false;
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;
      return true;
    });
  }, [fullLedger, typeFilter, accountFilter, dateFrom, dateTo]);

  useEffect(() => setPage(1), [typeFilter, accountFilter, dateFrom, dateTo]);

  const pageCount = Math.max(1, Math.ceil(ledger.length / PAGE_SIZE));
  const pagedLedger = ledger.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggle(paymentId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(paymentId)) next.delete(paymentId);
      else next.add(paymentId);
      return next;
    });
  }

  function load() {
    setLoading(true);
    Promise.all([
      api.get("/accounts/"),
      api.get("/capital-events/"),
      api.get("/investors/"),
      api.get("/transfers/"),
      api.get("/payments/"),
      api.get("/expenses/"),
    ])
      .then(([a, e, i, t, p, ex]) => {
        setAccounts(a);
        // Arranca en la cuenta en pesos (la principal): así se ve el saldo acumulado.
        if (!accountDefaulted.current) {
          accountDefaulted.current = true;
          setAccountFilter(String((a.find((x: Account) => x.currency === "ARS") || a[0])?.id ?? ""));
        }
        setEvents(e);
        setInvestors(i);
        setTransfers(t);
        setPayments(p);
        setExpenses(ex);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  // TC del día al cargar un aporte/rescate nuevo, o si se cambia la fecha al editar.
  useEffect(() => {
    if (!showForm || !eventDateTouched || !form.date) return;
    api.get(`/fx/ars-usd/?date=${form.date}`).then((r) => setForm((f) => ({ ...f, fx_ars_usd: r.ars_per_usd }))).catch(() => {});
  }, [showForm, eventDateTouched, form.date]);

  function openNewEvent() {
    const ars = accounts.find((a) => a.currency === "ARS") || accounts[0];
    setForm({ ...emptyEventForm(), account: ars ? String(ars.id) : "" });
    setEditingEventId(null);
    setEventDateTouched(true);
    setError("");
    setShowForm(true);
  }

  function openEditEvent(ev: CapitalEvent) {
    setForm({
      date: ev.date, investor: String(ev.investor), kind: ev.kind, amount_original: String(Number(ev.amount_original)),
      currency: ev.currency, fx_ars_usd: ev.fx_ars_usd, account: ev.account ? String(ev.account) : "", notes: ev.notes || "",
    });
    setEditingEventId(ev.id);
    setEventDateTouched(false);
    setError("");
    setShowForm(true);
  }

  function openNewTransfer() {
    const ars = accounts.find((a) => a.currency === "ARS") || accounts[0];
    const usd = accounts.find((a) => a.currency === "USD") || accounts[1] || accounts[0];
    setTransferForm({ ...emptyTransferForm(), from_account: ars ? String(ars.id) : "", to_account: usd ? String(usd.id) : "" });
    setEditingTransferId(null);
    setTransferError("");
    setShowTransferForm(true);
  }

  function openEditTransfer(t: Transfer) {
    setTransferForm({
      date: t.date, from_account: String(t.from_account), to_account: String(t.to_account),
      amount_from: String(Number(t.amount_from)), amount_to: String(Number(t.amount_to)), notes: t.notes || "",
    });
    setEditingTransferId(t.id);
    setTransferError("");
    setShowTransferForm(true);
  }

  const eventAmountUsd = form.currency === "USD"
    ? form.amount_original
    : form.amount_original && form.fx_ars_usd ? (Number(form.amount_original) / Number(form.fx_ars_usd)).toFixed(2) : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      ...form,
      fx_ars_usd: form.fx_ars_usd || "1",
      amount_usd: eventAmountUsd,
      investor: Number(form.investor),
      account: Number(form.account),
    };
    try {
      if (editingEventId) await api.patch(`/capital-events/${editingEventId}/`, payload);
      else await api.post("/capital-events/", payload);
      setShowForm(false);
      load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar el movimiento."));
    }
  }

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError("");
    const payload = {
      ...transferForm,
      from_account: Number(transferForm.from_account),
      to_account: Number(transferForm.to_account),
    };
    try {
      if (editingTransferId) await api.patch(`/transfers/${editingTransferId}/`, payload);
      else await api.post("/transfers/", payload);
      setShowTransferForm(false);
      load();
    } catch (err) {
      setTransferError(errorMessage(err, "No se pudo guardar la transferencia."));
    }
  }

  return (
    <div>
      <PageHeader
        title="Caja"
        sub="Saldos por cuenta y movimientos"
        actions={session?.role === "ADMIN" && (
          <>
            <button className="btn-secondary btn" onClick={openNewTransfer}><IconPlus size={16} /> Transferencia</button>
            <button className="btn" onClick={openNewEvent}><IconPlus size={16} /> Aporte / rescate</button>
          </>
        )}
      />

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {accounts.map((a) => (
          <div
            className={`card kpi-link${String(a.id) === accountFilter ? " card-selected" : ""}`}
            key={a.id}
            onClick={() => setAccountFilter(String(a.id))}
            style={{ cursor: "pointer" }}
          >
            <div className="kpi-label">{a.name}</div>
            <div className="kpi">{a.currency === "ARS" ? fmtARS(a.balance) : fmtUSD(a.balance)}</div>
          </div>
        ))}
      </div>

      {loading ? <div className="empty">Cargando...</div> : (
        <>
          <div className="card table-wrap" style={{ marginBottom: 16 }}>
            <CardHead title="Movimientos" aside="Todo lo que entra y sale, del más nuevo al más viejo · ▸ = cobro con reparto" />

            <Tabs
              active={accountFilter}
              onChange={setAccountFilter}
              tabs={[
                ...accounts.map((a) => ({ key: String(a.id), label: a.name })),
                { key: "", label: "Todas las cuentas" },
              ]}
            />

            <FilterBar
              active={!!(typeFilter || dateFrom || dateTo)}
              onClear={() => { setTypeFilter(""); setDateFrom(""); setDateTo(""); }}
            >
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as MovementType | "")}>
                <option value="">Tipo: todos</option>
                {(Object.keys(TYPE_LABEL) as MovementType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
              <PeriodFilter from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
            </FilterBar>

            <table>
              <thead>
                <tr>
                  <th></th><th>Fecha</th><th>Tipo</th><th>Detalle</th><th className="num">Monto</th>
                  {selectedAccount && <th className="num" title="Saldo de la cuenta después de cada movimiento">Saldo</th>}
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {pagedLedger.map((row) => (
                  <Fragment key={row.key}>
                    <tr
                      onClick={row.distributionId ? () => toggle(row.distributionId!) : undefined}
                      style={row.distributionId ? { cursor: "pointer" } : undefined}
                    >
                      <td className="small">{row.distributionId ? (expanded.has(row.distributionId) ? "▾" : "▸") : ""}</td>
                      <td style={{ width: 90 }}>{fmtDate(row.date)}</td>
                      <td style={{ width: 120 }}><span className="small">{TYPE_SINGULAR[row.type]}</span></td>
                      <td>{row.label}</td>
                      <td>{row.amountCell}</td>
                      {selectedAccount && (
                        <td className="num" style={{ fontWeight: 600 }}>
                          {runningBalance.has(row.key)
                            ? (selectedAccount.currency === "ARS" ? fmtARS(runningBalance.get(row.key)!) : fmtUSD(runningBalance.get(row.key)!))
                            : ""}
                        </td>
                      )}
                      {isAdmin && (
                        <td className="actions">
                          <RowActions onEdit={row.onEdit} onDelete={row.onDelete} />
                        </td>
                      )}
                    </tr>
                    {row.distributionId && expanded.has(row.distributionId) &&
                      row.distributionRows!.map((e) => (
                        <tr key={e.id} style={{ background: "var(--surface)" }}>
                          <td></td>
                          <td></td>
                          <td className="small">Reparto</td>
                          <td className="small">{e.investor_name} <span className="small">(se reinvierte, no mueve caja)</span></td>
                          <td>{moneyCell(e.currency, e.amount_original, e.amount_usd, e.fx_ars_usd, false)}</td>
                          {selectedAccount && <td></td>}
                          {isAdmin && <td></td>}
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {ledger.length === 0 && <div className="empty">Sin movimientos con estos filtros</div>}

            {ledger.length > 0 && (
              <div className="row" style={{ justifyContent: "space-between", marginTop: 14 }}>
                <span className="small">{ledger.length} movimientos · página {page} de {pageCount}</span>
                <div className="row">
                  <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
                  <button type="button" className="btn-ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {showForm && (
        <Modal title={editingEventId ? "Editar aporte / rescate" : "Aporte / rescate de capital"} onClose={() => setShowForm(false)}>
          <form className="form" onSubmit={submit}>
            <div>
              <label className="field-label">Tipo</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="CONTRIBUTION">Aporte directo</option>
                <option value="RESCUE">Rescate</option>
              </select>
            </div>
            <div>
              <label className="field-label">Inversor</label>
              <select required value={form.investor} onChange={(e) => setForm({ ...form, investor: e.target.value })}>
                <option value="">Elegir...</option>
                {investors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Fecha</label>
              <input type="date" required value={form.date} onChange={(e) => { setEventDateTouched(true); setForm({ ...form, date: e.target.value }); }} />
            </div>
            <div className="grid grid-2">
              <div>
                <label className="field-label">Monto</label>
                <input type="number" step="0.01" required value={form.amount_original} onChange={(e) => setForm({ ...form, amount_original: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Moneda</label>
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div>
              <label className="field-label">Cuenta</label>
              <select required value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {form.currency === "ARS" && (
              <div>
                <label className="field-label">Tipo de cambio</label>
                <input type="number" step="0.0001" required value={form.fx_ars_usd} onChange={(e) => setForm({ ...form, fx_ars_usd: e.target.value })} />
                {eventAmountUsd && <div className="small" style={{ marginTop: 4 }}>≈ USD {eventAmountUsd}</div>}
              </div>
            )}
            {error && <div className="err">{error}</div>}
            <button className="btn" type="submit">{editingEventId ? "Guardar cambios" : "Guardar"}</button>
          </form>
        </Modal>
      )}

      {showTransferForm && (
        <Modal title={editingTransferId ? "Editar transferencia" : "Transferencia entre cuentas"} onClose={() => setShowTransferForm(false)}>
          <form className="form" onSubmit={submitTransfer}>
            <div className="small">Para mover plata de una caja a otra (ej. comprar USD con ARS). No afecta capital.</div>
            <div>
              <label className="field-label">Fecha</label>
              <input type="date" required value={transferForm.date} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} />
            </div>
            <div className="grid grid-2">
              <div>
                <label className="field-label">Desde</label>
                <select required value={transferForm.from_account} onChange={(e) => setTransferForm({ ...transferForm, from_account: e.target.value })}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Monto que sale</label>
                <input type="number" step="0.01" required value={transferForm.amount_from} onChange={(e) => setTransferForm({ ...transferForm, amount_from: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-2">
              <div>
                <label className="field-label">Hacia</label>
                <select required value={transferForm.to_account} onChange={(e) => setTransferForm({ ...transferForm, to_account: e.target.value })}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Monto que entra</label>
                <input type="number" step="0.01" required value={transferForm.amount_to} onChange={(e) => setTransferForm({ ...transferForm, amount_to: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="field-label">Notas</label>
              <input value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} />
            </div>
            {transferError && <div className="err">{transferError}</div>}
            <button className="btn" type="submit">{editingTransferId ? "Guardar cambios" : "Guardar"}</button>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title={deleting.title}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(deleting.path); setDeleting(null); load(); }}
        >
          {deleting.text}
        </ConfirmModal>
      )}
    </div>
  );
}
