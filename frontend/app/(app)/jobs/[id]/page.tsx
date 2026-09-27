"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { InvoiceBalance, InvoiceChip } from "@/components/InvoiceStatus";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import InvoiceCreateModal from "@/components/InvoiceCreateModal";
import { JobForm, jobIsInvoiced } from "@/components/JobForm";
import { api, errorMessage } from "@/lib/api";
import { canEditOwn, isAdmin, useAuth } from "@/lib/auth";
import { JOB_STATUS_CHIP, fmtDate, fmtDateFull, fmtHa, fmtMoney, fmtUSD, jobStatusLabel } from "@/lib/format";
import { Field, PageHeader } from "@/components/ui";

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { session } = useAuth();
  const [data, setData] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [error, setError] = useState("");

  function load() {
    api.get(`/jobs/${params.id}/detail/`).then(setData).catch(() => setNotFound(true));
  }
  useEffect(load, [params.id]);

  async function openEdit() {
    if (!clients.length) setClients(await api.get("/clients/"));
    setEditing(true);
  }

  async function markDone() {
    setError("");
    try {
      await api.post(`/jobs/${params.id}/mark-done/`, {});
      load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo marcar como realizado."));
    }
  }

  if (notFound) {
    return (
      <div className="empty">
        No se encontró el trabajo. <Link href="/jobs" style={{ textDecoration: "underline" }}>Volver a Trabajos</Link>
      </div>
    );
  }
  if (!data) return <div className="empty">Cargando...</div>;
  const { job, invoices, payments, distributions, expenses } = data;
  const canEdit = canEditOwn(session, job.created_by);
  const admin = isAdmin(session);

  const lastPayment = [...payments].sort((a: any, b: any) => (a.date < b.date ? 1 : -1))[0];
  const allDistributed = payments.length > 0 && payments.every((p: any) => Number(p.distributed_usd) > 0);
  const lastDistribution = [...distributions].sort((a: any, b: any) => (a.date < b.date ? 1 : -1))[0];
  const sharedInvoice = invoices.find((inv: any) => inv.jobs.length > 1);

  // Línea de tiempo del trabajo: cada paso con la fecha en que se cumplió.
  const steps = [
    { label: "Realizado", date: job.status !== "PENDING" ? job.end_date || job.date : null },
    { label: "Facturado", date: invoices[0]?.date || null },
    { label: "Cobrado", date: job.status === "COLLECTED" ? lastPayment?.date || null : null },
    { label: "Repartido", date: allDistributed ? lastDistribution?.date || lastPayment?.date : null },
  ];

  // Reparto sumado por inversor (puede haber más de un cobro por factura).
  const byInvestor = new Map<string, { original: number; usd: number; currency: string }>();
  for (const d of distributions) {
    const row = byInvestor.get(d.investor_name) || { original: 0, usd: 0, currency: d.currency };
    row.original += Number(d.amount_original);
    row.usd += Number(d.amount_usd);
    byInvestor.set(d.investor_name, row);
  }

  return (
    <div>
      <PageHeader
        crumbs={[{ href: "/jobs", label: "Trabajos" }]}
        title={`${job.client_name} · ${job.work_type_label || "Trabajo"}`}
        badge={<span className={`chip ${JOB_STATUS_CHIP[job.status] || "c-pending"}`}>{jobStatusLabel(job.status)}</span>}
        sub={
          <>
            {fmtDateFull(job.date)}{job.end_date && job.end_date !== job.date ? ` al ${fmtDateFull(job.end_date)}` : ""}
            {" · "}{fmtHa(job.hectares)}{job.location ? ` · ${job.location}` : ""}
          </>
        }
        actions={
          <>
            {canEdit && <button className="btn-ghost" onClick={openEdit}>Editar</button>}
            {canEdit && (
              <button
                className="btn-ghost btn-danger"
                disabled={jobIsInvoiced(job)}
                title={jobIsInvoiced(job) ? "Está facturado: borrá primero la factura" : undefined}
                onClick={() => setDeleting(true)}
              >
                Borrar
              </button>
            )}
            {job.status === "PENDING" && canEdit && <button className="btn" onClick={markDone}>Marcar realizado</button>}
            {job.status === "DONE" && admin && <button className="btn" onClick={() => setInvoicing(true)}>Facturar</button>}
          </>
        }
      />

      {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}

      {job.status !== "CANCELLED" && (
        <div className="card timeline" style={{ marginBottom: 16 }}>
          {steps.map((s, i) => (
            <div key={s.label} className={`timeline-step${s.date ? " done" : ""}`}>
              <div className="timeline-dot">{s.date ? "✓" : i + 1}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.label}</div>
                <div className="small">{s.date ? fmtDateFull(s.date) : "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="detail-layout">
        <div className="card">
          <h2>Datos</h2>
          <Field label="Cliente" value={<Link href={`/clients/${job.client}`} className="link-strong">{job.client_name}</Link>} />
          <Field label="Tipo" value={job.work_type_label} />
          <Field label="Producto / semilla" value={job.product} />
          <Field label="Ubicación" value={job.location} />
          <Field label="Hectáreas" value={job.hectares ? fmtHa(job.hectares) : ""} />
          <Field label="Notas" value={job.notes} />
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Facturación</h2>
            {invoices.length === 0 ? (
              <div className="small">
                Sin facturar todavía.
                {job.status === "PENDING" && " Primero hay que marcarlo como realizado."}
              </div>
            ) : (
              invoices.map((inv: any) => {
                const invPayments = payments.filter((p: any) => p.invoice === inv.id);
                return (
                  <div key={inv.id} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div>
                        <div className="kpi-label">Factura · {fmtDate(inv.date)}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{fmtMoney(inv.amount_original, inv.currency)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <InvoiceChip inv={inv} />
                        {inv.status === "OPEN" && <div className="kpi-sub">Saldo <InvoiceBalance inv={inv} /></div>}
                      </div>
                    </div>
                    <table style={{ marginTop: 8 }}>
                      <tbody>
                        {invPayments.map((p: any) => (
                          <tr key={p.id}>
                            <td style={{ width: 110 }}>{fmtDate(p.date)}</td>
                            <td>Cobro</td>
                            <td className="num">{fmtMoney(p.amount_original, p.currency)}</td>
                            <td style={{ textAlign: "right", width: 110 }}>
                              {Number(p.distributed_usd) > 0
                                ? <span className="chip c-paid">Repartido</span>
                                : <span className="chip c-partial">Sin repartir</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {invPayments.length === 0 && <div className="small" style={{ marginTop: 6 }}>Todavía sin cobros.</div>}
                    {inv.status === "OPEN" && admin && (
                      <Link href="/invoices?tab=open" className="small link-strong" style={{ display: "inline-block", marginTop: 8 }}>
                        Registrar cobro en Facturación →
                      </Link>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {byInvestor.size > 0 && (
            <div className="card table-wrap" style={{ marginBottom: 16 }}>
              <h2>Reparto</h2>
              {sharedInvoice && (
                <div className="small" style={{ marginBottom: 8 }}>
                  La factura incluye {sharedInvoice.jobs.length} trabajos: el reparto es del cobro completo, no solo de este trabajo.
                </div>
              )}
              <table>
                <thead><tr><th>Inversor</th><th className="num">Monto</th><th className="num">USD</th></tr></thead>
                <tbody>
                  {Array.from(byInvestor.entries()).map(([name, row]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{fmtMoney(row.original, row.currency)}</td>
                      <td className="num small">{fmtUSD(row.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card table-wrap">
            <h2>Gastos asociados</h2>
            {expenses.length === 0 ? (
              <div className="small">Sin gastos asociados.</div>
            ) : (
              <table>
                <thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {expenses.map((exp: any) => (
                    <tr key={exp.id}>
                      <td style={{ width: 110 }}>{fmtDate(exp.date)}</td>
                      <td>{exp.concept}</td>
                      <td className="num">{fmtMoney(exp.amount_original, exp.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <Modal title="Editar trabajo" onClose={() => setEditing(false)}>
          <JobForm job={job} clients={clients} onSaved={() => { setEditing(false); load(); }} />
        </Modal>
      )}

      {invoicing && (
        <InvoiceCreateModal jobs={[job]} onClose={() => setInvoicing(false)} onDone={() => { setInvoicing(false); load(); }} />
      )}

      {deleting && (
        <ConfirmModal
          title="Borrar trabajo"
          onClose={() => setDeleting(false)}
          onConfirm={async () => { await api.del(`/jobs/${job.id}/`); router.push("/jobs"); }}
        >
          ¿Borrar el trabajo de <b>{job.client_name}</b> del {fmtDateFull(job.date)}?
          <div className="small" style={{ marginTop: 6 }}>Los gastos asociados quedan, pero sin trabajo. No se puede deshacer.</div>
        </ConfirmModal>
      )}
    </div>
  );
}
