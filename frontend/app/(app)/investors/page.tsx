"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Investor = {
  id: number;
  name: string;
  active: boolean;
  notes: string;
};

export default function InvestorsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Investor[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [active, setActive] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setActive(true);
  };

  const load = () => apiFetch<Investor[]>("/investors/").then(setRows);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load().catch(() => setError("No se pudo cargar inversores"));
  }, [router]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const payload = { name, active, notes: "" };
      if (editingId) {
        await apiFetch(`/investors/${editingId}/`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/investors/", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      await load();
    } catch {
      setError("No se pudo guardar el inversor");
    }
  };

  const onEdit = (row: Investor) => {
    setEditingId(row.id);
    setName(row.name);
    setActive(row.active);
  };

  const onDelete = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/investors/${id}/`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch {
      setError("No se pudo eliminar el inversor");
    }
  };

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const text = row.name.toLowerCase();
      const okSearch = text.includes(search.toLowerCase());
      const okStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && row.active) ||
        (statusFilter === "INACTIVE" && !row.active);
      return okSearch && okStatus;
    });
  }, [rows, search, statusFilter]);

  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>{editingId ? "Editar inversor" : "Nuevo inversor"}</h2>
        {error ? <p style={{ color: "#b42318", margin: 0 }}>{error}</p> : null}
        <form className="form" onSubmit={onSubmit}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required />
          <label className="row">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 16 }} />
            Activo
          </label>
          <div className="row">
            <button className="btn" type="submit">{editingId ? "Actualizar" : "Guardar"}</button>
            {editingId ? (
              <button className="btn btn-secondary" type="button" onClick={resetForm}>Cancelar</button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Inversores</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "INACTIVE") }>
            <option value="ALL">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Inactivos</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.active ? "Activo" : "Inactivo"}</td>
                <td>
                  <div className="row">
                    <button className="btn btn-secondary" onClick={() => onEdit(row)}>Editar</button>
                    <button className="btn btn-secondary" onClick={() => onDelete(row.id)}>Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
