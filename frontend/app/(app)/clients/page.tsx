"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { fmtDate, isPlaceholderClient, sumByCurrency, timeAgo } from "@/lib/format";
import Modal from "@/components/Modal";
import { ClientForm } from "@/components/ClientForm";
import { IconPlus } from "@/components/icons";
import { FilterBar, PageHeader, SearchInput } from "@/components/ui";

type Client = {
  id: number; name: string; active: boolean; tax_id: string; contact_name: string;
  phone: string; email: string; address: string; notes: string; debt_usd: string;
};
type Job = { id: number; client: number; date: string; hectares: string | null; status: string };
type Invoice = { client: number; currency: string; amount_original: string; balance_original: string; status: string };

type Row = Client & {
  jobCount: number; ha: number; lastJob: string; billed: string; balance: string; hasBalance: boolean;
};
type SortKey = "name" | "lastJob" | "ha" | "balance";

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });

  function load() {
    setLoading(true);
    Promise.all([api.get("/clients/"), api.get("/jobs/"), api.get("/invoices/")])
      .then(([c, j, i]) => { setClients(c); setJobs(j); setInvoices(i); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  // Actividad de cada cliente: trabajos, hectáreas, último trabajo, facturado y saldo
  // (en moneda original; se ordena por el equivalente USD que da el backend).
  const rows: Row[] = useMemo(() => {
    return clients.map((c) => {
      const cJobs = jobs.filter((j) => j.client === c.id && j.status !== "CANCELLED");
      const cInvoices = invoices.filter((i) => i.client === c.id);
      const open = cInvoices.filter((i) => i.status === "OPEN");
      return {
        ...c,
        jobCount: cJobs.length,
        ha: cJobs.reduce((sum, j) => sum + Number(j.hectares || 0), 0),
        lastJob: cJobs.reduce((max, j) => (j.date > max ? j.date : max), ""),
        billed: sumByCurrency(cInvoices.map((i) => ({ amount: i.amount_original, currency: i.currency }))),
        balance: sumByCurrency(open.map((i) => ({ amount: i.balance_original, currency: i.currency }))),
        hasBalance: Number(c.debt_usd) > 0,
      };
    });
  }, [clients, jobs, invoices]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => !q || [r.name, r.contact_name, r.tax_id].some((v) => (v || "").toLowerCase().includes(q)));
    const value = (r: Row) =>
      sort.key === "name" ? r.name.toLowerCase()
        : sort.key === "lastJob" ? r.lastJob
          : sort.key === "ha" ? r.ha
            : Number(r.debt_usd);
    return [...list].sort((a, b) => {
      // El cliente comodín va siempre al final, ordenes como ordenes.
      const pa = isPlaceholderClient(a.name), pb = isPlaceholderClient(b.name);
      if (pa !== pb) return pa ? 1 : -1;
      const va = value(a), vb = value(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, search, sort]);

  function sortBy(key: SortKey) {
    // Texto arranca A→Z; números y fechas arrancan de mayor a menor.
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  }
  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? " ↓" : " ↑") : "");
  const withBalance = rows.filter((r) => r.hasBalance).length;

  return (
    <div>
      <PageHeader
        title="Clientes"
        sub={`${clients.length} clientes${withBalance > 0 ? ` · ${withBalance} con saldo pendiente` : ""}`}
        actions={<button className="btn" onClick={() => setShowForm(true)}><IconPlus size={16} /> Nuevo cliente</button>}
      />

      <FilterBar active={!!search} onClear={() => setSearch("")}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar cliente o CUIT" />
      </FilterBar>

      {loading ? (
        <div className="empty">Cargando...</div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => sortBy("name")}>Nombre{arrow("name")}</th>
                <th className="sortable" onClick={() => sortBy("lastJob")}>Último trabajo{arrow("lastJob")}</th>
                <th className="num">Trabajos</th>
                <th className="num sortable" onClick={() => sortBy("ha")}>Ha{arrow("ha")}</th>
                <th className="num">Facturado</th>
                <th className="num sortable" onClick={() => sortBy("balance")}>Saldo{arrow("balance")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const placeholder = isPlaceholderClient(c.name);
                return (
                <tr key={c.id} className={`row-link${placeholder ? " row-muted" : ""}`} onClick={() => router.push(`/clients/${c.id}`)}>
                  <td style={{ fontWeight: 700 }}>
                    {c.name}
                    {placeholder && <span className="chip c-pending" style={{ marginLeft: 8 }} title="Agrupa trabajos a los que todavía no se les asignó cliente">A confirmar</span>}
                  </td>
                  <td>
                    {c.lastJob ? <>{fmtDate(c.lastJob)} <span className="small">· {timeAgo(c.lastJob)}</span></> : "—"}
                  </td>
                  <td className="num">{c.jobCount || "—"}</td>
                  <td className="num">{c.ha ? c.ha.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "—"}</td>
                  <td className="num">{c.billed}</td>
                  <td className="num">{c.hasBalance ? <b className="overdue">{c.balance}</b> : <span className="small">—</span>}</td>
                </tr>
                );
              })}
            </tbody>
            {visible.length > 1 && (
              <tfoot>
                <tr>
                  <td>Total · {visible.length} clientes</td>
                  <td></td>
                  <td className="num">{visible.reduce((n, c) => n + c.jobCount, 0)}</td>
                  <td className="num">{visible.reduce((n, c) => n + c.ha, 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}</td>
                  <td className="num">{sumByCurrency(invoices.filter((i) => visible.some((c) => c.id === i.client)).map((i) => ({ amount: i.amount_original, currency: i.currency })))}</td>
                  <td className="num">
                    {sumByCurrency(invoices.filter((i) => i.status === "OPEN" && visible.some((c) => c.id === i.client)).map((i) => ({ amount: i.balance_original, currency: i.currency })))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          {visible.length === 0 && <div className="empty">No hay clientes con esa búsqueda.</div>}
        </div>
      )}

      {showForm && (
        <Modal title="Nuevo cliente" onClose={() => setShowForm(false)}>
          <ClientForm client={null} onSaved={() => { setShowForm(false); load(); }} />
        </Modal>
      )}
    </div>
  );
}
