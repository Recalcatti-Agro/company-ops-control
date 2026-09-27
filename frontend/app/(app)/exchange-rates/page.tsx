"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import { IconPlus } from "@/components/icons";
import { PageHeader } from "@/components/ui";

type Rate = { id: number; date: string; ars_per_usd: string; source: string; notes: string };

export default function ExchangeRatesPage() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Rate | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), ars_per_usd: "", notes: "" });

  function load() {
    setLoading(true);
    api.get("/exchange-rates/").then(setRates).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editingId) await api.patch(`/exchange-rates/${editingId}/`, { ...form, source: "manual" });
      else await api.post("/exchange-rates/", { ...form, source: "manual" });
      setShowForm(false);
      load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar."));
    }
  }

  return (
    <div>
      <PageHeader
        title="Tipos de cambio"
        sub="Auditoría y fallback manual de ARS/USD"
        actions={
          <button className="btn" onClick={() => { setEditingId(null); setForm({ date: new Date().toISOString().slice(0, 10), ars_per_usd: "", notes: "" }); setError(""); setShowForm(true); }}>
            <IconPlus size={16} /> Nuevo
          </button>
        }
      />

      {loading ? <div className="empty">Cargando...</div> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>ARS por USD</th><th>Origen</th><th></th></tr></thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.date)}</td><td>{r.ars_per_usd}</td><td>{r.source}</td>
                  <td className="actions">
                    <RowActions
                      onEdit={() => { setEditingId(r.id); setForm({ date: r.date, ars_per_usd: String(Number(r.ars_per_usd)), notes: r.notes || "" }); setError(""); setShowForm(true); }}
                      onDelete={() => setDeleting(r)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rates.length === 0 && <div className="empty">Sin registros</div>}
        </div>
      )}

      {showForm && (
        <Modal title={editingId ? "Editar cotización" : "Nueva cotización"} onClose={() => setShowForm(false)}>
          <form className="form" onSubmit={submit}>
            <div>
              <label className="field-label">Fecha</label>
              <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <label className="field-label">ARS por USD</label>
              <input type="number" step="0.0001" required value={form.ars_per_usd} onChange={(e) => setForm({ ...form, ars_per_usd: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Notas</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {editingId && <div className="small">Solo cambia el registro de auditoría: los movimientos ya cargados guardan su propio tipo de cambio.</div>}
            {error && <div className="err">{error}</div>}
            <button className="btn" type="submit">{editingId ? "Guardar cambios" : "Guardar"}</button>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar cotización"
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(`/exchange-rates/${deleting.id}/`); setDeleting(null); load(); }}
        >
          ¿Borrar la cotización del {fmtDate(deleting.date)} ({deleting.ars_per_usd})? No afecta movimientos ya cargados.
        </ConfirmModal>
      )}
    </div>
  );
}
