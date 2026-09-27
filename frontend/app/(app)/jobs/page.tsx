"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { canEditOwn, useAuth } from "@/lib/auth";
import { JOB_STATUS_CHIP, capitalize, fmtDate, fmtHa } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import RowActions from "@/components/RowActions";
import Tabs from "@/components/Tabs";
import { JobForm, jobIsInvoiced, type JobRecord } from "@/components/JobForm";
import { IconPlus } from "@/components/icons";
import { WORK_TYPES } from "@/lib/workTypes";
import { CardHead, FilterBar, PageHeader, SearchInput } from "@/components/ui";

type Client = { id: number; name: string };
type Job = JobRecord;

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  DONE: "Realizado",
  INVOICED: "Facturado",
  COLLECTED: "Cobrado",
  CANCELLED: "Cancelado",
};

const PLURAL: Record<string, string> = {
  PENDING: "Pendientes", DONE: "Realizados", INVOICED: "Facturados", COLLECTED: "Cobrados", CANCELLED: "Cancelados",
};

// Pendientes, realizados y facturados (todo lo que falta cobrar, sin cancelados).
const NOT_COLLECTED = "__NOT_COLLECTED";

export default function JobsPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  // null = cerrado · "new" = alta · Job = edición
  const [editing, setEditing] = useState<Job | "new" | null>(null);
  const [deleting, setDeleting] = useState<Job | null>(null);
  const [error, setError] = useState("");

  const [filterClient, setFilterClient] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [search, setSearch] = useState("");
  const hasFilters = !!(filterClient || filterStatus || filterType || search);

  function clearFilters() {
    setFilterClient(""); setFilterStatus(""); setFilterType(""); setSearch("");
  }

  function load() {
    setLoading(true);
    Promise.all([api.get("/jobs/"), api.get("/clients/")])
      .then(([j, c]) => {
        setJobs(j);
        setClients(c);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function markDone(job: Job) {
    setError("");
    try {
      await api.post(`/jobs/${job.id}/mark-done/`, {});
      load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo marcar como realizado."));
    }
  }

  async function markPending(job: Job) {
    setError("");
    try {
      await api.post(`/jobs/${job.id}/mark-pending/`, {});
      load();
    } catch (err) {
      setError(errorMessage(err, "No se puede volver a pendiente: ya tiene factura."));
    }
  }

  // Opciones de producto y ubicación: las que ya existen en los trabajos cargados.

  // Todos los filtros menos el estado: sobre esto se cuentan las pestañas.
  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (filterClient && String(j.client) !== filterClient) return false;
      if (filterType && j.work_type !== filterType) return false;
      if (q && ![j.client_name, j.location, j.product, j.work_type_label, j.notes].some((v) => (v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [jobs, filterClient, filterType, search]);

  const matchesStatus = (j: Job, status: string) =>
    status === NOT_COLLECTED ? j.status !== "COLLECTED" && j.status !== "CANCELLED" : !status || j.status === status;
  const filtered = useMemo(() => baseFiltered.filter((j) => matchesStatus(j, filterStatus)), [baseFiltered, filterStatus]);
  const statusTabs = [
    { key: "", label: "Todos" },
    { key: NOT_COLLECTED, label: "Sin cobrar" },
    ...Object.entries(STATUS_LABEL)
      .filter(([k]) => k !== "CANCELLED" || jobs.some((j) => j.status === "CANCELLED"))
      .map(([k, v]) => ({ key: k, label: PLURAL[k] || v })),
  ].map((t) => ({ ...t, count: baseFiltered.filter((j) => matchesStatus(j, t.key)).length }));

  const totalHectares = useMemo(() => filtered.reduce((sum, j) => sum + Number(j.hectares || 0), 0), [filtered]);

  const grouped = useMemo(() => {
    const groups: Record<string, Job[]> = {};
    for (const job of filtered) {
      const key = job.date.slice(0, 7);
      groups[key] = groups[key] || [];
      groups[key].push(job);
    }
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  // Trabajos que falta facturar: se facturan desde Facturación → "Por facturar".
  const toInvoiceCount = jobs.filter((j) => j.status === "PENDING" || j.status === "DONE").length;

  return (
    <div>
      <PageHeader
        title="Trabajos"
        sub={
          <>
            {hasFilters ? `${filtered.length} de ${jobs.length} trabajos` : `${jobs.length} trabajos`}
            {" · "}{fmtHa(totalHectares)}
            {session?.role === "ADMIN" && toInvoiceCount > 0 && (
              <>
                {" · "}
                <Link href="/invoices?tab=to-invoice" className="link-strong">{toInvoiceCount} sin facturar →</Link>
              </>
            )}
          </>
        }
        actions={<button className="btn" onClick={() => setEditing("new")}><IconPlus size={16} /> Nuevo trabajo</button>}
      />

      <Tabs tabs={statusTabs} active={filterStatus} onChange={setFilterStatus} />

      <FilterBar active={hasFilters} onClear={clearFilters}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar cliente, lugar, producto" />
        <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
          <option value="">Cliente: todos</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">Tipo: todos</option>
          {WORK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </FilterBar>

      {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div className="empty">Cargando...</div>
      ) : (
        grouped.map(([month, monthJobs]) => (
          <div className="card table-wrap" key={month} style={{ marginBottom: 16 }}>
            <CardHead
              title={capitalize(new Date(month + "-02").toLocaleDateString("es-AR", { month: "long", year: "numeric" }))}
              aside={`${monthJobs.length} trabajo${monthJobs.length === 1 ? "" : "s"} · ${fmtHa(monthJobs.reduce((sum, j) => sum + Number(j.hectares || 0), 0))}`}
            />
            {/* Anchos fijos: cada mes es una tabla aparte y así las columnas quedan alineadas. */}
            <table style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 90 }} /><col style={{ width: "26%" }} /><col />
                <col style={{ width: 80 }} /><col style={{ width: 105 }} /><col style={{ width: 150 }} /><col style={{ width: 76 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Fecha</th><th>Cliente</th><th>Tipo</th><th className="num">Ha</th><th>Estado</th><th></th><th></th>
                </tr>
              </thead>
              <tbody>
                {monthJobs.map((job) => (
                  <tr key={job.id} className="row-link" onClick={() => router.push(`/jobs/${job.id}`)}>
                    <td>{fmtDate(job.date)}</td>
                    <td style={{ fontWeight: 600 }}>{job.client_name}</td>
                    <td>
                      {job.work_type_label || "—"}
                      {job.location && <span className="small"> · {job.location}</span>}
                    </td>
                    <td className="num">{job.hectares ? Number(job.hectares).toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "—"}</td>
                    <td><span className={`chip ${JOB_STATUS_CHIP[job.status]}`}>{STATUS_LABEL[job.status]}</span></td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                      {job.status === "PENDING" && <button className="btn-ghost" onClick={() => markDone(job)}>Marcar realizado</button>}
                      {job.status === "DONE" && <button className="btn-ghost" onClick={() => markPending(job)}>Volver a pendiente</button>}
                    </td>
                    <td className="actions">
                      {canEditOwn(session, job.created_by) && (
                        <RowActions
                          onEdit={() => setEditing(job)}
                          onDelete={jobIsInvoiced(job) ? undefined : () => setDeleting(job)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
      {!loading && grouped.length === 0 && <div className="empty">No hay trabajos con estos filtros.</div>}

      {editing && (
        <Modal title={editing === "new" ? "Nuevo trabajo" : "Editar trabajo"} onClose={() => setEditing(null)}>
          <JobForm
            job={editing === "new" ? null : editing}
            clients={clients}
            onSaved={() => { setEditing(null); load(); }}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar trabajo"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.del(`/jobs/${deleting.id}/`);
            setDeleting(null);
            load();
          }}
        >
          ¿Borrar el trabajo de <b>{deleting.client_name}</b> del {fmtDate(deleting.date)}
          {deleting.work_type_label ? ` (${deleting.work_type_label})` : ""}?
          <div className="small" style={{ marginTop: 6 }}>Los gastos asociados quedan, pero sin trabajo. No se puede deshacer.</div>
        </ConfirmModal>
      )}

    </div>
  );
}


