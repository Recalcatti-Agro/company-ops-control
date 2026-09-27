"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

export type ClientRecord = {
  id: number; name: string; active: boolean; tax_id: string; contact_name: string;
  phone: string; email: string; address: string; notes: string;
};

// Alta (client = null) o edición de un cliente. Guarda solo y avisa con onSaved.
export function ClientForm({ client, onSaved }: { client: ClientRecord | null; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: client?.name || "", tax_id: client?.tax_id || "", contact_name: client?.contact_name || "",
    phone: client?.phone || "", email: client?.email || "", address: client?.address || "", notes: client?.notes || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (client) await api.patch(`/clients/${client.id}/`, form);
      else await api.post("/clients/", form);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar el cliente."));
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div>
        <label className="field-label">Nombre</label>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-2">
        <div>
          <label className="field-label">CUIT</label>
          <input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Contacto</label>
          <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-2">
        <div>
          <label className="field-label">Teléfono</label>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="field-label">Dirección</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div>
        <label className="field-label">Notas</label>
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      {error && <div className="err">{error}</div>}
      <button className="btn" type="submit" disabled={saving}>{client ? "Guardar cambios" : "Guardar"}</button>
    </form>
  );
}
