"use client";

import { WORK_TYPES } from "@/lib/workTypes";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { IconClose } from "@/components/icons";

type Client = { id: number; name: string };

export default function QuickJobPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [newClientMode, setNewClientMode] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    client: "",
    location: "",
    work_type: "",
    product: "",
    hectares: "",
    notes: "",
  });

  useEffect(() => {
    api.get("/clients/").then(setClients);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      let clientId = form.client;
      if (newClientMode && newClientName) {
        const created = await api.post("/clients/", { name: newClientName });
        clientId = String(created.id);
      }
      await api.post("/jobs/", { ...form, client: Number(clientId), hectares: form.hectares || null });
      router.push("/home");
    } catch {
      setError("No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="pageh">
        <h1>Nuevo trabajo</h1>
        <button className="btn-ghost" onClick={() => router.back()} type="button" style={{ width: 44, height: 44, borderRadius: 12 }}>
          <IconClose />
        </button>
      </div>

      <form className="form" onSubmit={submit}>
        <div>
          <label className="field-label">Fecha</label>
          <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>

        <div>
          <label className="field-label">Cliente</label>
          {!newClientMode ? (
            <>
              <select required value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })}>
                <option value="">Elegir...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <a href="#" onClick={(e) => { e.preventDefault(); setNewClientMode(true); }} style={{ fontSize: 13, fontWeight: 700, color: "var(--primary-2)", marginTop: 8, display: "inline-block" }}>
                + Nuevo cliente
              </a>
            </>
          ) : (
            <>
              <input required value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Nombre del cliente" />
              <a href="#" onClick={(e) => { e.preventDefault(); setNewClientMode(false); }} style={{ fontSize: 13, fontWeight: 700, color: "var(--primary-2)", marginTop: 8, display: "inline-block" }}>
                Elegir cliente existente
              </a>
            </>
          )}
        </div>

        <div>
          <label className="field-label">Ubicación</label>
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Ej: potrero norte, El Retiro" />
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
          <label className="field-label">Notas (opcional)</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        {error && <div className="err">{error}</div>}
        <button className="btn" type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar trabajo"}</button>
      </form>
    </div>
  );
}
