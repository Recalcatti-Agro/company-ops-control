"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type ExchangeRate = {
  id: number;
  date: string;
  ars_per_usd: string;
  source: string;
};

export default function ConversionsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ExchangeRate[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [arsPerUsd, setArsPerUsd] = useState("");
  const [source, setSource] = useState("manual");

  const [search, setSearch] = useState("");

  const load = () => apiFetch<ExchangeRate[]>("/exchange-rates/").then(setRows);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load().catch(() => setError("No se pudo cargar tipos de cambio"));
  }, [router]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => `${row.date} ${row.source}`.toLowerCase().includes(search.toLowerCase()));
  }, [rows, search]);

  const resetForm = () => {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setArsPerUsd("");
    setSource("manual");
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    const payload = {
      date,
      ars_per_usd: arsPerUsd,
      source,
      notes: "",
    };

    try {
      if (editingId) {
        await apiFetch(`/exchange-rates/${editingId}/`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/exchange-rates/", { method: "POST", body: JSON.stringify(payload) });
      }
      resetForm();
      await load();
    } catch {
      setError("No se pudo guardar el tipo de cambio");
    }
  };

  const onEdit = (row: ExchangeRate) => {
    setEditingId(row.id);
    setDate(row.date);
    setArsPerUsd(row.ars_per_usd);
    setSource(row.source || "manual");
  };

  const onDelete = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/exchange-rates/${id}/`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch {
      setError("No se pudo eliminar el tipo de cambio");
    }
  };

  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>{editingId ? "Editar tipo de cambio" : "Nuevo tipo de cambio"}</h2>
        {error ? <p style={{ color: "#b42318", margin: 0 }}>{error}</p> : null}
        <form className="form" onSubmit={onSubmit}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <input value={arsPerUsd} onChange={(e) => setArsPerUsd(e.target.value)} placeholder="ARS por 1 USD" required />
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Origen" />
          <div className="row">
            <button className="btn" type="submit">
              {editingId ? "Actualizar" : "Guardar"}
            </button>
            {editingId ? (
              <button className="btn btn-secondary" type="button" onClick={resetForm}>
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Tipos de cambio</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>ARS/USD</th>
                <th>Origen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.date}</td>
                  <td>{Number(row.ars_per_usd).toFixed(4)}</td>
                  <td>{row.source || "-"}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn-secondary" onClick={() => onEdit(row)}>
                        Editar
                      </button>
                      <button className="btn btn-secondary" onClick={() => onDelete(row.id)}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
