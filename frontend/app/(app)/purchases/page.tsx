"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import { IconPlus } from "@/components/icons";
import Tabs from "@/components/Tabs";
import { FilterBar, PageHeader, ProgressBar, SearchInput } from "@/components/ui";

type Purchase = {
  id: number; date: string; concept: string; category: string; total_amount: string;
  currency: string; total_amount_usd: string | null; installment_count: number;
  first_due_date: string | null; status: string; notes: string;
};

const STATUS_CHIP: Record<string, string> = { ACTIVE: "c-open", COMPLETED: "c-paid", CANCELLED: "c-pending" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Pagando cuotas", COMPLETED: "Pagada", CANCELLED: "Cancelada" };

function emptyForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    concept: "", category: "", total_amount: "", currency: "USD",
    total_amount_usd: "", installment_count: "0", first_due_date: "", status: "ACTIVE",
  };
}

export default function PurchasesPage() {
  const { session } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Purchase | null>(null);
  const [bills, setBills] = useState<{ purchase: number | null; paid_amount_original: string; status: string }[]>([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const hasPaidInstallments = (p: Purchase) => bills.some((b) => b.purchase === p.id && Number(b.paid_amount_original) > 0);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());

  const paidInstallments = (p: Purchase) => bills.filter((b) => b.purchase === p.id && b.status === "PAID").length;
  const visible = purchases.filter((p) => {
    if (filterStatus && p.status !== filterStatus) return false;
    const q = search.trim().toLowerCase();
    return !q || `${p.concept} ${p.category || ""}`.toLowerCase().includes(q);
  });

  function openNew() {
    setEditingId(null);
    setForm(emptyForm());
    setError("");
    setShowForm(true);
  }

  function openEdit(p: Purchase) {
    setEditingId(p.id);
    setForm({
      date: p.date, concept: p.concept, category: p.category || "",
      total_amount: String(Number(p.total_amount)), currency: p.currency,
      total_amount_usd: p.total_amount_usd ? String(Number(p.total_amount_usd)) : "",
      installment_count: String(p.installment_count), first_due_date: p.first_due_date || "", status: p.status,
    });
    setError("");
    setShowForm(true);
  }

  function load() {
    setLoading(true);
    api.get("/purchases/").then(setPurchases).finally(() => setLoading(false));
    api.get("/bills/").then(setBills).catch(() => {});
  }
  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      ...form,
      installment_count: Number(form.installment_count),
      total_amount_usd: form.currency === "USD" ? form.total_amount : form.total_amount_usd || null,
      first_due_date: Number(form.installment_count) > 0 ? form.first_due_date : null,
    };
    try {
      if (editingId) await api.patch(`/purchases/${editingId}/`, payload);
      else await api.post("/purchases/", payload);
      setShowForm(false);
      load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar la compra."));
    }
  }

  return (
    <div>
      <PageHeader
        title="Compras"
        sub={`${purchases.length} compras`}
        actions={session?.role === "ADMIN" && <button className="btn" onClick={openNew}><IconPlus size={16} /> Nueva compra</button>}
      />

      <Tabs
        active="purchases"
        tabs={[
          { key: "purchases", label: "Compras", href: "/purchases" },
          { key: "bills", label: "Vencimientos", href: "/bills" },
        ]}
      />

      {!loading && (
        <FilterBar active={!!(search || filterStatus)} onClear={() => { setSearch(""); setFilterStatus(""); }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar (concepto...)" />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Estado: todos</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </FilterBar>
      )}

      {loading ? <div className="empty">Cargando...</div> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Monto</th><th>Cuotas pagadas</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 90 }}>{fmtDate(p.date)}</td>
                  <td>{p.concept}</td>
                  <td className="num">{fmtMoney(p.total_amount, p.currency)}</td>
                  <td style={{ width: 170 }}>
                    {p.installment_count > 0 ? <InstallmentProgress paid={paidInstallments(p)} total={p.installment_count} /> : <span className="small">Contado</span>}
                  </td>
                  <td><span className={`chip ${STATUS_CHIP[p.status] || "c-pending"}`}>{STATUS_LABEL[p.status] || p.status}</span></td>
                  <td className="actions">
                    {session?.role === "ADMIN" && <RowActions onEdit={() => openEdit(p)} onDelete={() => setDeleting(p)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <div className="empty">{purchases.length ? "No hay compras con estos filtros." : "Sin compras todavía."}</div>}
        </div>
      )}

      {showForm && (
        <Modal title={editingId ? "Editar compra" : "Nueva compra"} onClose={() => setShowForm(false)}>
          <form className="form" onSubmit={submit}>
            <div>
              <label className="field-label">Concepto</label>
              <input required value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} />
            </div>
            <div className="grid grid-2">
              <div>
                <label className="field-label">Categoría</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Fecha</label>
                <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-2">
              <div>
                <label className="field-label">Monto total</label>
                <input type="number" step="0.01" required value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
              </div>
              <div>
                <label className="field-label">Moneda</label>
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </select>
              </div>
            </div>
            <div className="grid grid-2">
              <div>
                <label className="field-label">Cantidad de cuotas</label>
                <input type="number" min="0" value={form.installment_count} onChange={(e) => setForm({ ...form, installment_count: e.target.value })} />
              </div>
              {Number(form.installment_count) > 0 && (
                <div>
                  <label className="field-label">Primer vencimiento</label>
                  <input type="date" required value={form.first_due_date} onChange={(e) => setForm({ ...form, first_due_date: e.target.value })} />
                </div>
              )}
            </div>
            {editingId && (
              <div>
                <label className="field-label">Estado</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            )}
            {editingId && Number(form.installment_count) > 0 && (
              <div className="small">Las cuotas sin pagos se recalculan con el nuevo monto, cantidad y vencimiento. Las ya pagadas no se tocan.</div>
            )}
            {error && <div className="err">{error}</div>}
            <button className="btn" type="submit">{editingId ? "Guardar cambios" : "Guardar"}</button>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar compra"
          blocked={hasPaidInstallments(deleting)}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(`/purchases/${deleting.id}/`); setDeleting(null); load(); }}
        >
          ¿Borrar <b>{deleting.concept}</b> ({fmtMoney(deleting.total_amount, deleting.currency)})?
          <div className="small" style={{ marginTop: 6 }}>
            {hasPaidInstallments(deleting)
              ? "Tiene cuotas con pagos: no se puede borrar. Si ya no corre, editala y ponela como Cancelada."
              : `${deleting.installment_count > 0 ? `Se borran también sus ${deleting.installment_count} cuotas. ` : ""}No se puede deshacer.`}
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

function InstallmentProgress({ paid, total }: { paid: number; total: number }) {
  return (
    <div>
      <div className="small" style={{ marginBottom: 3 }}>{paid} de {total}</div>
      <ProgressBar pct={(paid / total) * 100} height={6} />
    </div>
  );
}
