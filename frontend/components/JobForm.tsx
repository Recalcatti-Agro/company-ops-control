"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { WORK_TYPES } from "@/lib/workTypes";

export type JobRecord = {
  id: number; date: string; end_date: string | null; client: number; client_name: string;
  location: string; hectares: string | null; work_type: string; product: string;
  work_type_label: string; notes: string; status: string; created_by: number | null;
};

// Alta (job = null) o edición de un trabajo. Guarda solo y avisa con onSaved.
export function JobForm({
  job,
  clients,
  onSaved,
  defaultClient,
}: {
  job: JobRecord | null;
  clients: { id: number; name: string }[];
  onSaved: () => void;
  defaultClient?: number; // alta desde la ficha de un cliente: viene elegido
}) {
  const [form, setForm] = useState({
    date: job?.date || new Date().toISOString().slice(0, 10),
    end_date: job?.end_date || "",
    client: job ? String(job.client) : defaultClient ? String(defaultClient) : "",
    location: job?.location || "",
    work_type: job?.work_type || "",
    product: job?.product || "",
    hectares: job?.hectares ? String(Number(job.hectares)) : "",
    notes: job?.notes || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const invoiced = job?.status === "INVOICED" || job?.status === "COLLECTED";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload = { ...form, client: Number(form.client), hectares: form.hectares || null, end_date: form.end_date || null };
    try {
      if (job) await api.patch(`/jobs/${job.id}/`, payload);
      else await api.post("/jobs/", payload);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar el trabajo."));
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="grid grid-2">
        <div>
          <label className="field-label">Fecha</label>
          <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Fecha de fin (opcional)</label>
          <input type="date" value={form.end_date} min={form.date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="field-label">Cliente</label>
        <select required value={form.client} disabled={invoiced} onChange={(e) => setForm({ ...form, client: e.target.value })}>
          <option value="">Elegir...</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {invoiced && <div className="small" style={{ marginTop: 4 }}>El cliente no se puede cambiar: el trabajo ya está facturado.</div>}
      </div>
      <div>
        <label className="field-label">Ubicación</label>
        <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Ej: potrero norte" />
      </div>
      <div className="grid grid-2">
        <div>
          <label className="field-label">Tipo de trabajo</label>
          <select value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value })}>
            <option value="">Elegir...</option>
            {WORK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Hectáreas</label>
          <input type="number" step="0.01" value={form.hectares} onChange={(e) => setForm({ ...form, hectares: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="field-label">Producto / semilla</label>
        <input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="Ej: urea, centeno, fungicida" />
      </div>
      <div>
        <label className="field-label">Notas</label>
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      {error && <div className="err">{error}</div>}
      <button className="btn" type="submit" disabled={saving}>{job ? "Guardar cambios" : "Guardar"}</button>
    </form>
  );
}

export function jobIsInvoiced(job: { status: string }) {
  return job.status === "INVOICED" || job.status === "COLLECTED";
}
