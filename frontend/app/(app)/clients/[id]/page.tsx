"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { InvoiceBalance, InvoiceChip } from "@/components/InvoiceStatus";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import { ClientForm } from "@/components/ClientForm";
import { JobForm } from "@/components/JobForm";
import Tabs from "@/components/Tabs";
import { IconPlus } from "@/components/icons";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import {
  JOB_STATUS_CHIP, capitalize, fmtDate, fmtHa, fmtMoney, fmtUSD, isPlaceholderClient, jobStatusLabel, sumByCurrency,
} from "@/lib/format";
import { Field, Kpi, PageHeader } from "@/components/ui";

const haOf = (jobs: any[]) => jobs.reduce((acc, j) => acc + Number(j.hectares || 0), 0);

// Los valores más frecuentes de un campo, con cuántas veces aparece cada uno.
function topValues(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  for (const v of values.filter(Boolean)) counts.set(v, (counts.get(v) || 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

type TabKey = "invoices" | "jobs" | "payments";

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { session } = useAuth();
  const [data, setData] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newJob, setNewJob] = useState(false);
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const [tab, setTab] = useState<TabKey>("invoices");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function load() {
    api.get(`/clients/${params.id}/detail/`).then(setData).catch(() => setNotFound(true));
  }
  useEffect(load, [params.id]);

  async function openNewJob() {
    if (!clients.length) setClients(await api.get("/clients/"));
    setNewJob(true);
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (notFound) {
    return (
      <div className="empty">
        No se encontró el cliente. <Link href="/clients" style={{ textDecoration: "underline" }}>Volver a Clientes</Link>
      </div>
    );
  }
  if (!data) return <div className="empty">Cargando...</div>;
  const { client, debt_usd, jobs, invoices, payments } = data;
  const admin = isAdmin(session);

  const jobsById: Record<number, any> = Object.fromEntries(jobs.map((j: any) => [j.id, j]));
  const activeJobs = jobs.filter((j: any) => j.status !== "CANCELLED");
  const uninvoicedJobs = jobs.filter((j: any) => j.status === "PENDING" || j.status === "DONE");
  const openInvoices = invoices.filter((inv: any) => inv.status === "OPEN");
  const hasDebt = openInvoices.length > 0;
  const contactFields = [
    ["CUIT", client.tax_id], ["Contacto", client.contact_name], ["Teléfono", client.phone],
    ["Email", client.email], ["Dirección", client.address],
  ].filter(([, v]) => v);
  const sortedInvoices = [...invoices].sort((a: any, b: any) => (a.date < b.date ? 1 : -1));
  const sortedJobs = [...jobs].sort((a: any, b: any) => (a.date < b.date ? 1 : -1));
  const sortedPayments = [...payments].sort((a: any, b: any) => (a.date < b.date ? 1 : -1));
  const invoiceDate = Object.fromEntries(invoices.map((inv: any) => [inv.id, inv.date]));

  const firstJob = activeJobs.reduce((min: string, j: any) => (!min || j.date < min ? j.date : min), "");
  const topTypes = topValues(activeJobs.map((j: any) => j.work_type_label));
  const topPlaces = topValues(activeJobs.map((j: any) => j.location));

  return (
    <div>
      <PageHeader
        crumbs={[{ href: "/clients", label: "Clientes" }]}
        title={client.name}
        badge={isPlaceholderClient(client.name) ? <span className="chip c-pending">A confirmar</span> : undefined}
        actions={
          <>
            {admin && <button className="btn-ghost" onClick={() => setEditing(true)}>Editar</button>}
            {admin && (
              <button
                className="btn-ghost btn-danger"
                disabled={jobs.length > 0 || invoices.length > 0}
                title={jobs.length > 0 || invoices.length > 0 ? "Tiene trabajos o facturas: no se puede borrar" : undefined}
                onClick={() => setDeleting(true)}
              >
                Borrar
              </button>
            )}
            <button className="btn" onClick={openNewJob}><IconPlus size={16} /> Nuevo trabajo</button>
          </>
        }
      />

      <div className="kpi-row">
        {/* Saldo en moneda original; ámbar si hay deuda (el verde se lee como "todo bien"). */}
        <Kpi
          label="Saldo pendiente"
          tone={hasDebt ? "warn" : undefined}
          value={hasDebt ? sumByCurrency(openInvoices.map((i: any) => ({ amount: i.balance_original, currency: i.currency }))) : "Al día"}
          sub={hasDebt ? `${openInvoices.length} factura${openInvoices.length === 1 ? "" : "s"} · ≈ ${fmtUSD(debt_usd)}` : "Sin facturas por cobrar"}
        />
        <Kpi
          label="Facturado histórico"
          value={sumByCurrency(invoices.map((i: any) => ({ amount: i.amount_original, currency: i.currency })))}
          sub={`${invoices.length} factura${invoices.length === 1 ? "" : "s"} · cobrado ${sumByCurrency(payments.map((p: any) => ({ amount: p.amount_original, currency: p.currency })))}`}
        />
        <Kpi
          label="Trabajos"
          value={`${activeJobs.length} · ${fmtHa(haOf(activeJobs))}`}
          sub={uninvoicedJobs.length ? `${uninvoicedJobs.length} sin facturar (${fmtHa(haOf(uninvoicedJobs))})` : "Todos facturados"}
        />
      </div>

      <div className="detail-layout">
        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <h2>Contacto</h2>
            {contactFields.length > 0 ? (
              contactFields.map(([label, v]) => <Field key={label} label={label} value={v} />)
            ) : (
              <div className="small">
                Sin datos de contacto.
                {admin && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn-ghost" onClick={() => setEditing(true)}>Agregar datos de contacto</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {activeJobs.length > 0 && (
            <div className="card">
              <h2>Resumen</h2>
              <Field label="Cliente desde" value={capitalize(new Date(firstJob + "T00:00").toLocaleDateString("es-AR", { month: "long", year: "numeric" }))} />
              {topTypes.length > 0 && (
                <Field label="Trabajos más hechos" value={<ValueList items={topTypes} />} />
              )}
              {topPlaces.length > 0 && <Field label="Lugares" value={<ValueList items={topPlaces} />} />}
            </div>
          )}

          {client.notes && (
            <div className="card">
              <h2>Notas</h2>
              <div className="notes">{client.notes}</div>
            </div>
          )}
        </div>

        <div>
          {uninvoicedJobs.length > 0 && (
            <div className="card card-warn callout" style={{ marginBottom: 16 }}>
              <div>
                <b>{uninvoicedJobs.length} trabajo{uninvoicedJobs.length === 1 ? "" : "s"} sin facturar</b>
                <span className="small"> · {fmtHa(haOf(uninvoicedJobs))}</span>
              </div>
              {admin && (
                <Link href={`/invoices?tab=to-invoice&client=${client.id}`} className="link-strong">Facturar →</Link>
              )}
            </div>
          )}

          <div className="card table-wrap">
            <Tabs
              active={tab}
              onChange={(k) => setTab(k as TabKey)}
              tabs={[
                { key: "invoices", label: "Facturas", count: invoices.length },
                { key: "jobs", label: "Trabajos", count: jobs.length },
                { key: "payments", label: "Cobros", count: payments.length },
              ]}
            />

            {tab === "invoices" && (
              invoices.length === 0 ? <div className="empty">Todavía sin facturas.</div> : (
                <table>
                  <thead>
                    <tr><th></th><th>Fecha</th><th>Trabajos</th><th className="num">Monto</th><th className="num">Saldo</th><th>Estado</th></tr>
                  </thead>
                  <tbody>
                    {sortedInvoices.map((inv: any) => {
                      const invJobs = inv.jobs.map((id: number) => jobsById[id]).filter(Boolean);
                      const invPayments = payments.filter((p: any) => p.invoice === inv.id).sort((a: any, b: any) => (a.date < b.date ? -1 : 1));
                      const open = expanded.has(inv.id);
                      return (
                        <Fragment key={inv.id}>
                          <tr className="row-link" onClick={() => toggle(inv.id)}>
                            <td className="small" style={{ width: 20 }}>{open ? "▾" : "▸"}</td>
                            <td style={{ width: 90 }}>{fmtDate(inv.date)}</td>
                            <td>
                              {invJobs.map((j: any) => j.work_type_label || "Trabajo").filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ")}
                              <span className="small">
                                {invJobs.length > 1 ? ` · ${invJobs.length} trabajos` : ""}
                                {haOf(invJobs) > 0 ? ` · ${fmtHa(haOf(invJobs))}` : ""}
                              </span>
                            </td>
                            <td className="num">{fmtMoney(inv.amount_original, inv.currency)}</td>
                            <td className="num">{inv.status === "OPEN" || inv.is_overpaid ? <b><InvoiceBalance inv={inv} /></b> : <span className="small">—</span>}</td>
                            <td><InvoiceChip inv={inv} /></td>
                          </tr>
                          {open && (
                            <tr className="row-detail">
                              <td></td>
                              <td colSpan={5}>
                                <div className="section-label" style={{ marginTop: 4 }}>Trabajos</div>
                                <JobsTable jobs={invJobs} />
                                <div className="section-label">Cobros</div>
                                {invPayments.length === 0 ? <div className="small">Todavía sin cobros.</div> : (
                                  <table>
                                    <tbody>
                                      {invPayments.map((p: any) => (
                                        <tr key={p.id}>
                                          <td style={{ width: 90 }}>{fmtDate(p.date)}</td>
                                          <td className="num" style={{ width: 140 }}>{fmtMoney(p.amount_original, p.currency)}</td>
                                          <td>
                                            {Number(p.distributed_usd) > 0
                                              ? <span className="chip c-paid">Repartido</span>
                                              : <span className="chip c-partial">Sin repartir</span>}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}

            {tab === "jobs" && (jobs.length === 0 ? <div className="empty">Todavía sin trabajos.</div> : <JobsTable jobs={sortedJobs} />)}

            {tab === "payments" && (
              payments.length === 0 ? <div className="empty">Todavía sin cobros.</div> : (
                <table>
                  <thead><tr><th>Fecha</th><th>Factura</th><th className="num">Monto</th><th>Reparto</th></tr></thead>
                  <tbody>
                    {sortedPayments.map((p: any) => (
                      <tr key={p.id}>
                        <td style={{ width: 90 }}>{fmtDate(p.date)}</td>
                        <td className="small">Factura del {fmtDate(invoiceDate[p.invoice])}</td>
                        <td className="num">{fmtMoney(p.amount_original, p.currency)}</td>
                        <td>
                          {Number(p.distributed_usd) > 0
                            ? <span className="chip c-paid">Repartido</span>
                            : <span className="chip c-partial">Sin repartir</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        </div>
      </div>

      {newJob && (
        <Modal title={`Nuevo trabajo · ${client.name}`} onClose={() => setNewJob(false)}>
          <JobForm job={null} clients={clients} defaultClient={client.id} onSaved={() => { setNewJob(false); load(); }} />
        </Modal>
      )}

      {editing && (
        <Modal title="Editar cliente" onClose={() => setEditing(false)}>
          <ClientForm client={client} onSaved={() => { setEditing(false); load(); }} />
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar cliente"
          onClose={() => setDeleting(false)}
          onConfirm={async () => { await api.del(`/clients/${client.id}/`); router.push("/clients"); }}
        >
          ¿Borrar el cliente <b>{client.name}</b>? No se puede deshacer.
        </ConfirmModal>
      )}
    </div>
  );
}

function ValueList({ items }: { items: [string, number][] }) {
  return (
    <div>
      {items.map(([v, n]) => (
        <div key={v} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{v}</span><span className="small">{n}</span>
        </div>
      ))}
    </div>
  );
}

function JobsTable({ jobs }: { jobs: any[] }) {
  const router = useRouter();
  return (
    <table>
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Lugar</th><th className="num">Ha</th><th>Estado</th></tr></thead>
      <tbody>
        {jobs.map((j: any) => (
          <tr key={j.id} className="row-link" onClick={() => router.push(`/jobs/${j.id}`)}>
            <td style={{ width: 90 }}>{fmtDate(j.date)}</td>
            <td>{j.work_type_label || "—"}{j.product ? <span className="small"> · {j.product}</span> : null}</td>
            <td>{j.location || <span className="small">—</span>}</td>
            <td className="num">{j.hectares ? Number(j.hectares).toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "—"}</td>
            <td><span className={`chip ${JOB_STATUS_CHIP[j.status] || "c-pending"}`}>{jobStatusLabel(j.status)}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
