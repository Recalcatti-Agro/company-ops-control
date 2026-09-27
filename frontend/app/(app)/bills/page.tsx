"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { daysSince, fmtDate, fmtMoney, sumByCurrency } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import { IconPlus } from "@/components/icons";
import Tabs from "@/components/Tabs";
import { PageHeader } from "@/components/ui";

type Bill = {
  id: number; concept: string; source: string; due_date: string; currency: string;
  amount_original: string; estimated_amount_usd: string; paid_amount_usd: string; paid_amount_original: string; status: string;
};

const STATUS_CHIP: Record<string, string> = { PENDING: "c-pending", PARTIAL: "c-partial", PAID: "c-paid", CANCELLED: "c-cancel" };
const STATUS_LABEL: Record<string, string> = { PENDING: "Pendiente", PARTIAL: "Pago parcial", PAID: "Pagada", CANCELLED: "Cancelada" };

export default function BillsPage() {
  const { session } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Bill | null>(null);
  const [fx, setFx] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ concept: "", due_date: new Date().toISOString().slice(0, 10), amount_original: "", currency: "USD" });

  useEffect(() => {
    api.get("/fx/ars-usd/").then((r) => setFx(r.ars_per_usd)).catch(() => {});
  }, []);

  function openNew() {
    setEditingId(null);
    setForm({ concept: "", due_date: new Date().toISOString().slice(0, 10), amount_original: "", currency: "USD" });
    setError("");
    setShowForm(true);
  }

  function openEdit(b: Bill) {
    setEditingId(b.id);
    setForm({ concept: b.concept, due_date: b.due_date, amount_original: String(Number(b.amount_original)), currency: b.currency });
    setError("");
    setShowForm(true);
  }

  function load() {
    setLoading(true);
    api.get("/bills/").then(setBills).finally(() => setLoading(false));
  }
  useEffect(load, []);

  // Agrupado por urgencia: lo vencido y lo próximo arriba; lo pagado al final y plegado.
  const grouped = useMemo(() => {
    const groups: { key: string; title: string; bills: Bill[]; tone?: string }[] = [
      { key: "overdue", title: "Vencidas", bills: [], tone: "overdue" },
      { key: "week", title: "Vencen esta semana", bills: [] },
      { key: "month", title: "Próximos 30 días", bills: [] },
      { key: "later", title: "Más adelante", bills: [] },
      { key: "closed", title: "Pagadas", bills: [] },
    ];
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    for (const b of [...bills].sort((a, c) => (a.due_date < c.due_date ? -1 : 1))) {
      const days = daysSince(b.due_date); // > 0: ya venció hace `days` días
      const key = b.status === "PAID" || b.status === "CANCELLED" ? "closed"
        : days > 0 ? "overdue" : days >= -7 ? "week" : days >= -30 ? "month" : "later";
      byKey[key].bills.push(b);
    }
    byKey.closed.bills.reverse(); // pagadas: la más reciente primero
    return groups.filter((g) => g.bills.length > 0);
  }, [bills]);
  const [showClosed, setShowClosed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const estimatedUsd = form.currency === "USD"
      ? form.amount_original
      : fx ? (Number(form.amount_original) / Number(fx)).toFixed(2) : "";
    const payload = { ...form, estimated_amount_usd: estimatedUsd };
    try {
      if (editingId) await api.patch(`/bills/${editingId}/`, payload);
      else await api.post("/bills/", payload);
      setShowForm(false);
      load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar la cuenta a pagar."));
    }
  }

  return (
    <div>
      <PageHeader
        title="Compras"
        sub="Cuotas de compras y otras cuentas a pagar, por vencimiento"
        actions={session?.role === "ADMIN" && <button className="btn" onClick={openNew}><IconPlus size={16} /> Nueva cuenta a pagar</button>}
      />
      <Tabs
        active="bills"
        tabs={[
          { key: "purchases", label: "Compras", href: "/purchases" },
          { key: "bills", label: "Vencimientos", href: "/bills" },
        ]}
      />

      {!loading && bills.length > 0 && grouped.every((g) => g.key === "closed") && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="small">Nada pendiente de pago: todas las cuotas y cuentas están pagadas.</div>
        </div>
      )}

      {loading ? <div className="empty">Cargando...</div> : grouped.map((group) => {
        const collapsed = group.key === "closed" && !showClosed;
        return (
          <div className="card table-wrap" key={group.key} style={{ marginBottom: 16 }}>
            <div className="card-head" style={collapsed ? { marginBottom: 0 } : undefined}>
              <h2 className={group.tone}>{group.title}</h2>
              <span className="small">
                {group.bills.length} · {sumByCurrency(group.bills.map((b) => ({
                  amount: Number(b.amount_original) - (group.key === "closed" ? 0 : Number(b.paid_amount_original)),
                  currency: b.currency,
                })))}
                {group.key === "closed" && (
                  <button type="button" className="btn-ghost" style={{ marginLeft: 10 }} onClick={() => setShowClosed((v) => !v)}>
                    {showClosed ? "Ocultar" : "Mostrar"}
                  </button>
                )}
              </span>
            </div>
            {!collapsed && (
              <table>
                <thead><tr><th>Vence</th><th>Concepto</th><th className="num">Monto</th><th className="num">Pagado</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {group.bills.map((b) => {
                    const days = daysSince(b.due_date);
                    return (
                      <tr key={b.id}>
                        <td style={{ width: 150 }}>
                          {fmtDate(b.due_date)}
                          {group.key === "overdue" && <span className="small overdue"> · hace {days} d</span>}
                          {(group.key === "week" || group.key === "month") && (
                            <span className="small"> · {days === 0 ? "hoy" : `en ${-days} d`}</span>
                          )}
                        </td>
                        <td>{b.concept}</td>
                        <td className="num">{fmtMoney(b.amount_original, b.currency)}</td>
                        <td className="num">{Number(b.paid_amount_original) > 0 ? fmtMoney(b.paid_amount_original, b.currency) : <span className="small">—</span>}</td>
                        <td>
                          {group.key === "overdue"
                            ? <span className="chip c-danger">Vencida</span>
                            : <span className={`chip ${STATUS_CHIP[b.status]}`}>{STATUS_LABEL[b.status]}</span>}
                        </td>
                        <td className="actions">
                          {session?.role === "ADMIN" && b.source === "MANUAL" && (
                            <RowActions onEdit={() => openEdit(b)} onDelete={() => setDeleting(b)} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {!loading && bills.length === 0 && <div className="empty">Sin cuentas a pagar</div>}

      {showForm && (
        <Modal title={editingId ? "Editar cuenta a pagar" : "Nueva cuenta a pagar"} onClose={() => setShowForm(false)}>
          <form className="form" onSubmit={submit}>
            <div>
              <label className="field-label">Concepto</label>
              <input required value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Vencimiento</label>
              <input type="date" required value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div className="grid grid-2">
              <div>
                <label className="field-label">Monto</label>
                <input type="number" step="0.01" required value={form.amount_original} onChange={(e) => setForm({ ...form, amount_original: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Moneda</label>
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </select>
              </div>
            </div>
            {error && <div className="err">{error}</div>}
            <button className="btn" type="submit">{editingId ? "Guardar cambios" : "Guardar"}</button>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar cuenta a pagar"
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(`/bills/${deleting.id}/`); setDeleting(null); load(); }}
        >
          ¿Borrar <b>{deleting.concept}</b> (vence {fmtDate(deleting.due_date)}, {fmtMoney(deleting.amount_original, deleting.currency)})?
          <div className="small" style={{ marginTop: 6 }}>
            {Number(deleting.paid_amount_original) > 0 ? "Los gastos que la pagaron quedan, pero sin cuenta asociada. " : ""}No se puede deshacer.
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}
