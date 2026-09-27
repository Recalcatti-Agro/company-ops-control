"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtARS, fmtDate, fmtPct, fmtUSD } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import { IconPlus } from "@/components/icons";
import { PageHeader, ProgressBar } from "@/components/ui";

type CapRow = { investor_id: number; name: string; capital_usd: string; percentage: string };
const KIND_LABEL: Record<string, string> = { CONTRIBUTION: "Aporte", RESCUE: "Rescate", JOB_DISTRIBUTION: "Reparto" };

export default function InvestorsPage() {
  const { session } = useAuth();
  const [rows, setRows] = useState<CapRow[]>([]);
  const [totalCapital, setTotalCapital] = useState("0");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ id: number; name: string; events: any[] } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<CapRow | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    api.get("/investors/cap-table/").then((r) => { setRows(r.rows); setTotalCapital(r.total_capital_usd); }).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function openDetail(row: CapRow) {
    const events = await api.get(`/investors/${row.investor_id}/capital-events/`);
    setDetail({ id: row.investor_id, name: row.name, events });
  }

  async function submitInvestor(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editingId) await api.patch(`/investors/${editingId}/`, { name });
      else await api.post("/investors/", { name });
      setShowForm(false);
      setName("");
      load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar."));
    }
  }

  return (
    <div>
      <PageHeader
        title="Inversores"
        sub={`Participación · capital total ${fmtUSD(totalCapital)}`}
        actions={session?.role === "ADMIN" && (
          <button className="btn" onClick={() => { setEditingId(null); setName(""); setError(""); setShowForm(true); }}>
            <IconPlus size={16} /> Nuevo inversor
          </button>
        )}
      />

      {loading ? <div className="empty">Cargando...</div> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Inversor</th><th className="num">Capital</th><th style={{ width: "35%" }}>Participación</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                // Se puede ver el detalle propio (o el de cualquiera, si es admin).
                const canSee = session?.role === "ADMIN" || session?.investorId === r.investor_id;
                return (
                <tr key={r.investor_id} className={canSee ? "row-link" : undefined} onClick={canSee ? () => openDetail(r) : undefined}>
                  <td style={{ fontWeight: 700 }}>{r.name}</td>
                  <td className="num">{fmtUSD(r.capital_usd)}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <ProgressBar pct={Number(r.percentage)} />
                      <span className="num" style={{ width: 48, fontWeight: 700 }}>{fmtPct(r.percentage)}</span>
                    </div>
                  </td>
                  <td className="actions">
                    {session?.role === "ADMIN" && (
                      <RowActions
                        onEdit={() => { setEditingId(r.investor_id); setName(r.name); setError(""); setShowForm(true); }}
                        onDelete={() => setDeleting(r)}
                      />
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">Sin inversores activos</div>}
        </div>
      )}

      {detail && (
        <Modal title={`Capital de ${detail.name}`} onClose={() => setDetail(null)}>
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {detail.events.map((ev: any) => (
                <tr key={ev.id}>
                  <td>{fmtDate(ev.date)}</td>
                  <td>{KIND_LABEL[ev.kind]}</td>
                  <td className="num">
                    {ev.currency === "ARS" ? fmtARS(ev.amount_original) : fmtUSD(ev.amount_original)}
                    {ev.currency === "ARS" && <span className="small"> · {fmtUSD(ev.amount_usd)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.events.length === 0 && <div className="empty">Sin movimientos</div>}
        </Modal>
      )}

      {showForm && (
        <Modal title={editingId ? "Editar inversor" : "Nuevo inversor"} onClose={() => setShowForm(false)}>
          <form className="form" onSubmit={submitInvestor}>
            <div>
              <label className="field-label">Nombre</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error && <div className="err">{error}</div>}
            <button className="btn" type="submit">{editingId ? "Guardar cambios" : "Guardar"}</button>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar inversor"
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(`/investors/${deleting.investor_id}/`); setDeleting(null); load(); }}
        >
          ¿Borrar a <b>{deleting.name}</b>?
          <div className="small" style={{ marginTop: 6 }}>Solo se puede si no tiene aportes, repartos ni gastos pagados. No se puede deshacer.</div>
        </ConfirmModal>
      )}
    </div>
  );
}
