"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import Modal from "@/components/Modal";

type JobRef = { id: number; client: number; client_name: string };

// Factura uno o más trabajos de un mismo cliente (siempre en ARS).
export default function InvoiceCreateModal({ jobs, onClose, onDone }: { jobs: JobRef[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountArs, setAmountArs] = useState("");
  const [fx, setFx] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/fx/ars-usd/?date=${date}`).then((r) => setFx(r.ars_per_usd)).catch(() => {});
  }, [date]);

  const amountUsd = amountArs && fx ? (Number(amountArs) / Number(fx)).toFixed(2) : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/invoices/", {
        client: jobs[0].client,
        jobs: jobs.map((j) => j.id),
        date,
        amount_original: amountArs,
        currency: "ARS",
        fx_ars_usd: fx,
        amount_usd: amountUsd,
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "No se pudo facturar."));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Facturar ${jobs.length} trabajo${jobs.length === 1 ? "" : "s"} · ${jobs[0]?.client_name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div>
          <label className="field-label">Fecha de factura</label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid grid-2">
          <div>
            <label className="field-label">Monto ARS</label>
            <input type="number" step="0.01" required value={amountArs} onChange={(e) => setAmountArs(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Tipo de cambio</label>
            <input type="number" step="0.0001" required value={fx} onChange={(e) => setFx(e.target.value)} />
          </div>
        </div>
        {amountUsd && <div className="small">≈ USD {amountUsd}</div>}
        {error && <div className="err">{error}</div>}
        <button className="btn" type="submit" disabled={saving}>Facturar</button>
      </form>
    </Modal>
  );
}
