"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Client = { id: number; name: string; active: boolean };

export default function QuickWorkPage() {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [workType, setWorkType] = useState("");
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [selectedClientId, setSelectedClientId] = useState<number | "">("");
  const [newClientName, setNewClientName] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [showExtra, setShowExtra] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [hectares, setHectares] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMessage, setOkMessage] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    apiFetch<Client[]>("/clients/")
      .then(setClients)
      .catch(() => setError("No se pudo cargar la pantalla"));
  }, [router]);

  const clientOk =
    clientMode === "existing" ? Boolean(selectedClientId) : Boolean(newClientName.trim());

  const canSubmit = workType.trim() && clientOk;

  const resolveClientName = async (): Promise<string> => {
    if (clientMode === "existing") {
      return clients.find((c) => c.id === selectedClientId)?.name || "";
    }
    const name = newClientName.trim();
    if (!name) return "";
    const existing = clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.name;
    const created = await apiFetch<Client>("/clients/", {
      method: "POST",
      body: JSON.stringify({ name, active: true, notes: "" }),
    });
    setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "es")));
    setClientMode("existing");
    setSelectedClientId(created.id);
    setNewClientName("");
    return created.name;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setOkMessage("");

    if (!canSubmit) return;

    setSaving(true);
    try {
      const clientName = await resolveClientName();
      await apiFetch("/jobs/", {
        method: "POST",
        body: JSON.stringify({
          date,
          end_date: endDate || null,
          client: clientName,
          hectares: hectares ? Number(hectares) : null,
          work_type: workType.trim(),
          notes,
        }),
      });
      setWorkType("");
      setSelectedClientId("");
      setNewClientName("");
      setEndDate("");
      setHectares("");
      setNotes("");
      setClientMode("existing");
      setOkMessage("Trabajo guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el trabajo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card quick-expense-card" style={{ maxWidth: 480, margin: "0 auto" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ marginBottom: 0 }}>Trabajo rápido</h2>
        <Link href="/works" className="btn btn-secondary" style={{ padding: "8px 10px" }}>
          Ver trabajos
        </Link>
      </div>

      {error ? <p style={{ color: "#b42318", margin: "0 0 10px" }}>{error}</p> : null}
      {okMessage ? <p style={{ color: "#067647", margin: "0 0 10px" }}>{okMessage}</p> : null}

      <form className="form" onSubmit={onSubmit}>

        {/* Fecha */}
        <div className="ifta-field">
          <input
            id="qw-date"
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <label htmlFor="qw-date">Fecha inicio</label>
        </div>

        {/* Tipo de trabajo */}
        <div className="ifta-field">
          <input
            id="qw-work-type"
            name="work_type"
            placeholder=" "
            value={workType}
            onChange={(e) => setWorkType(e.target.value)}
            required
          />
          <label htmlFor="qw-work-type">Tipo de trabajo</label>
        </div>

        {/* Cliente */}
        {clientMode === "existing" ? (
          <div className="ifta-field filled">
            <select
              id="qw-client"
              name="client"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Seleccionar cliente</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label htmlFor="qw-client">Cliente</label>
          </div>
        ) : (
          <div className="ifta-field">
            <input
              id="qw-new-client"
              name="new_client"
              placeholder=" "
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
            />
            <label htmlFor="qw-new-client">Nombre del cliente nuevo</label>
          </div>
        )}

        <button
          type="button"
          className="qe-extra-toggle"
          onClick={() => {
            if (clientMode === "existing") {
              setClientMode("new");
              setSelectedClientId("");
            } else {
              setClientMode("existing");
              setNewClientName("");
            }
          }}
          style={{ marginTop: -4 }}
        >
          {clientMode === "existing" ? "+ Nuevo cliente" : "← Seleccionar existente"}
        </button>

        <button
          className="btn"
          type="submit"
          disabled={saving || !canSubmit}
          style={{ marginTop: 8 }}
        >
          {saving ? "Guardando..." : "Agregar"}
        </button>

        {/* Campos adicionales */}
        <button
          type="button"
          className="qe-extra-toggle"
          onClick={() => setShowExtra((prev) => !prev)}
        >
          {showExtra ? "▲ Menos campos" : "▼ Más campos"}
        </button>

        {showExtra ? (
          <>
            <div className="ifta-field">
              <input
                id="qw-end-date"
                name="end_date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <label htmlFor="qw-end-date">Fecha fin (opcional)</label>
            </div>

            <div className="ifta-field">
              <input
                id="qw-hectares"
                name="hectares"
                inputMode="decimal"
                placeholder=" "
                value={hectares}
                onChange={(e) => setHectares(e.target.value)}
              />
              <label htmlFor="qw-hectares">Hectáreas</label>
            </div>

            <div className="ifta-field">
              <input
                id="qw-notes"
                name="notes"
                placeholder=" "
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <label htmlFor="qw-notes">Aclaraciones</label>
            </div>
          </>
        ) : null}

      </form>
    </section>
  );
}
