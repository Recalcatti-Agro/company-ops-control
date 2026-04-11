"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { apiFetch, getToken } from "@/lib/api";

type JobStatus = "PENDING" | "DONE" | "INVOICED" | "COLLECTED" | "CANCELLED";
type CollectionDisplayStatus = "BILLED" | "PARTIAL" | "COLLECTED";
type CollectionStatus = "BILLED" | "COLLECTED";
type CollectionType = "INVOICE" | "PAYMENT";

type JobDetailResponse = {
  job: {
    id: number;
    date: string;
    end_date: string | null;
    client: string;
    hectares: string | null;
    work_type: string;
    status: JobStatus;
    notes: string;
  };
  summary: {
    invoice_count: number;
    payment_count: number;
    invoiced_total_usd: string;
    collected_total_usd: string;
    remaining_total_usd: string;
    tax_loss_total_usd: string;
  };
  collections: JobCollectionDetail[];
  timeline: TimelineEvent[];
};

type JobReference = {
  id: number;
  date: string;
  end_date: string | null;
  client: string;
  work_type: string;
  status: JobStatus;
};

type JobDistributionDetail = {
  id: number;
  kind: "FIELD_TEAM" | "SHAREHOLDER" | "REINVESTMENT";
  kind_label: string;
  investor_id: number | null;
  investor_name: string | null;
  percentage: string | null;
  amount_usd: string;
  work_amount_usd: string;
  shareholder_amount_usd: string;
  reinvest_to_cash_usd: string;
  notes: string;
};

type JobCollectionDetail = {
  id: number;
  parent_collection: number | null;
  collection_type: CollectionType;
  display_status: CollectionDisplayStatus | CollectionStatus;
  collection_date: string;
  status: CollectionStatus;
  amount_ars: string;
  amount_usd: string;
  collected_currency: "USD" | "ARS" | null;
  collected_amount_original: string | null;
  collected_fx_ars_usd: string | null;
  converted_to_usd: boolean;
  collected_amount_usd: string | null;
  tax_loss_usd: string;
  remaining_amount_usd: string;
  remaining_amount_ars: string;
  settled_total_usd: string;
  notes: string;
  related_jobs: JobReference[];
  distributions: JobDistributionDetail[];
  partial_collections: JobCollectionDetail[];
};

type TimelineEvent = {
  date: string;
  kind: "WORK" | "WORK_END" | "INVOICE" | "PAYMENT";
  label: string;
  detail: string;
  notes: string;
};

const statusLabel: Record<JobStatus, string> = {
  PENDING: "Pendiente",
  DONE: "Realizado",
  INVOICED: "Facturado",
  COLLECTED: "Cobrado",
  CANCELLED: "Cancelado",
};

const statusClass: Record<JobStatus, string> = {
  PENDING: "status-pending",
  DONE: "status-done",
  INVOICED: "status-billed",
  COLLECTED: "status-collected",
  CANCELLED: "status-cancelled",
};

const collectionStatusLabel: Record<CollectionDisplayStatus | CollectionStatus, string> = {
  BILLED: "Facturado",
  PARTIAL: "C Parcial",
  COLLECTED: "Cobrado",
};

const collectionStatusClass: Record<CollectionDisplayStatus | CollectionStatus, string> = {
  BILLED: "status-billed",
  PARTIAL: "status-partial",
  COLLECTED: "status-collected",
};

const formatNumber = (value: string | number | null | undefined, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));

const formatDate = (value: string | null) => {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-AR");
};

const paymentRowsForInvoice = (invoice: JobCollectionDetail) =>
  invoice.partial_collections.length ? invoice.partial_collections : invoice.display_status === "COLLECTED" ? [invoice] : [];

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span className="small">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DistributionTable({ rows }: { rows: JobDistributionDetail[] }) {
  if (!rows.length) {
    return <div className="small">Sin distribuciones registradas para este cobro.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Inversor</th>
            <th>%</th>
            <th>USD</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.kind_label}</td>
              <td>{row.investor_name || "-"}</td>
              <td>{row.percentage ? `${formatNumber(row.percentage, 2)}%` : "-"}</td>
              <td>{formatNumber(row.amount_usd)}</td>
              <td>{row.notes || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WorkDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<JobDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const workId = useMemo(() => Number(params?.id), [params]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    if (!workId || Number.isNaN(workId)) {
      setError("ID de trabajo inválido.");
      setLoading(false);
      return;
    }

    setLoading(true);
    apiFetch<JobDetailResponse>(`/jobs/${workId}/detail/`)
      .then((response) => {
        setDetail(response);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el detalle del trabajo"))
      .finally(() => setLoading(false));
  }, [router, workId]);

  const jobPeriod = detail
    ? detail.job.end_date
      ? `${formatDate(detail.job.date)} → ${formatDate(detail.job.end_date)}`
      : formatDate(detail.job.date)
    : "-";

  return (
    <section className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "grid", gap: 8 }}>
            <Link href="/works" className="small" style={{ width: "fit-content" }}>
              ← Volver a trabajos
            </Link>
            <div>
              <h2 style={{ marginBottom: 4 }}>{detail ? `Trabajo #${detail.job.id}` : "Detalle del trabajo"}</h2>
              <div className="small">
                {detail ? `${detail.job.client || "Sin cliente"} · ${detail.job.work_type || "Sin tipo"}` : "Cargando..."}
              </div>
            </div>
          </div>
          {detail ? (
            <span className={`chip-label chip-status ${statusClass[detail.job.status]}`}>{statusLabel[detail.job.status]}</span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: "#b42318", margin: 0 }}>{error}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="card">
          <p style={{ margin: 0 }}>Cargando detalle...</p>
        </div>
      ) : null}

      {detail ? (
        <>
          <div className="grid grid-2">
            <div className="card" style={{ display: "grid", gap: 12 }}>
              <h3 style={{ marginBottom: 0 }}>Trabajo</h3>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <DetailField label="Período" value={jobPeriod} />
                <DetailField label="Cliente" value={detail.job.client || "-"} />
                <DetailField label="Tipo" value={detail.job.work_type || "-"} />
                <DetailField label="Hectáreas" value={detail.job.hectares ? formatNumber(detail.job.hectares) : "-"} />
                <DetailField label="Estado" value={statusLabel[detail.job.status]} />
              </div>
              <div>
                <div className="small" style={{ marginBottom: 4 }}>
                  Comentarios
                </div>
                <div>{detail.job.notes || "Sin comentarios."}</div>
              </div>
            </div>

            <div className="card" style={{ display: "grid", gap: 12 }}>
              <h3 style={{ marginBottom: 0 }}>Resumen económico</h3>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <div className="card" style={{ padding: 12 }}>
                  <div className="small">Facturas</div>
                  <div className="kpi" style={{ fontSize: 24 }}>
                    {detail.summary.invoice_count}
                  </div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="small">Cobros</div>
                  <div className="kpi" style={{ fontSize: 24 }}>
                    {detail.summary.payment_count}
                  </div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="small">USD facturado</div>
                  <div className="kpi" style={{ fontSize: 24 }}>
                    {formatNumber(detail.summary.invoiced_total_usd)}
                  </div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="small">USD cobrado</div>
                  <div className="kpi" style={{ fontSize: 24 }}>
                    {formatNumber(detail.summary.collected_total_usd)}
                  </div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="small">USD pendiente</div>
                  <div className="kpi" style={{ fontSize: 24 }}>
                    {formatNumber(detail.summary.remaining_total_usd)}
                  </div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="small">USD impuestos/pérdida</div>
                  <div className="kpi" style={{ fontSize: 24 }}>
                    {formatNumber(detail.summary.tax_loss_total_usd)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ display: "grid", gap: 12 }}>
            <h3 style={{ marginBottom: 0 }}>Historial</h3>
            {detail.timeline.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {detail.timeline.map((event, index) => (
                  <div
                    key={`${event.kind}-${event.date}-${index}`}
                    style={{
                      display: "grid",
                      gap: 4,
                      padding: 12,
                      border: "1px solid var(--line)",
                      borderRadius: 12,
                      background: "var(--surface)",
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <strong>{event.label}</strong>
                      <span className="small">{formatDate(event.date)}</span>
                    </div>
                    <div>{event.detail}</div>
                    {event.notes ? <div className="small">{event.notes}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="small">No hay eventos registrados todavía.</div>
            )}
          </div>

          <div className="card" style={{ display: "grid", gap: 14 }}>
            <h3 style={{ marginBottom: 0 }}>Facturas y cobros</h3>
            {detail.collections.length ? (
              detail.collections.map((invoice) => {
                const paymentRows = paymentRowsForInvoice(invoice);
                const paymentTaxTotal = paymentRows.reduce((acc, payment) => acc + Number(payment.tax_loss_usd || 0), 0);
                return (
                  <div
                    key={invoice.id}
                    style={{
                      display: "grid",
                      gap: 12,
                      padding: 14,
                      border: "1px solid var(--line)",
                      borderRadius: 14,
                      background: "var(--surface)",
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <strong>{`Factura #${invoice.id}`}</strong>
                        <span className={`chip-label chip-status ${collectionStatusClass[invoice.display_status]}`}>
                          {collectionStatusLabel[invoice.display_status]}
                        </span>
                        <span className="chip-label">{`Fecha ${formatDate(invoice.collection_date)}`}</span>
                      </div>
                      <div className="small">{paymentRows.length ? `${paymentRows.length} cobro(s)` : "Sin cobros"}</div>
                    </div>

                    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                      <DetailField label="ARS factura" value={formatNumber(invoice.amount_ars)} />
                      <DetailField label="USD factura" value={formatNumber(invoice.amount_usd)} />
                      <DetailField label="USD cobrados" value={formatNumber(invoice.settled_total_usd)} />
                      <DetailField label="USD pendientes" value={formatNumber(invoice.remaining_amount_usd)} />
                      <DetailField label="USD impuestos" value={formatNumber(paymentTaxTotal)} />
                    </div>

                    {invoice.related_jobs.length > 1 ? (
                      <div>
                        <div className="small" style={{ marginBottom: 4 }}>
                          Factura compartida con
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          {invoice.related_jobs.map((job) => (
                            <span key={job.id} className="chip-label">
                              {`#${job.id} ${job.work_type || "Trabajo"}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {invoice.notes ? (
                      <div>
                        <div className="small" style={{ marginBottom: 4 }}>
                          Comentarios de factura
                        </div>
                        <div>{invoice.notes}</div>
                      </div>
                    ) : null}

                    {paymentRows.length ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        {paymentRows.map((payment) => (
                          <div
                            key={payment.id}
                            style={{
                              display: "grid",
                              gap: 10,
                              padding: 12,
                              border: "1px solid var(--line)",
                              borderRadius: 12,
                              background: "var(--card)",
                            }}
                          >
                            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                                <strong>{payment.parent_collection ? `Cobro #${payment.id}` : "Cobro directo"}</strong>
                                <span className={`chip-label chip-status ${collectionStatusClass.COLLECTED}`}>Cobrado</span>
                              </div>
                              <span className="small">{formatDate(payment.collection_date)}</span>
                            </div>

                            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                              <DetailField
                                label={`Cobrado ${payment.collected_currency || "USD"}`}
                                value={
                                  payment.collected_amount_original ? formatNumber(payment.collected_amount_original) : formatNumber(payment.amount_usd)
                                }
                              />
                              <DetailField label="USD cobrados" value={formatNumber(payment.collected_amount_usd || payment.amount_usd)} />
                              <DetailField label="USD impuestos" value={formatNumber(payment.tax_loss_usd)} />
                              <DetailField label="TC ARS/USD" value={payment.collected_fx_ars_usd ? formatNumber(payment.collected_fx_ars_usd, 4) : "-"} />
                            </div>

                            {payment.notes ? (
                              <div>
                                <div className="small" style={{ marginBottom: 4 }}>
                                  Comentarios del cobro
                                </div>
                                <div>{payment.notes}</div>
                              </div>
                            ) : null}

                            <div>
                              <div className="small" style={{ marginBottom: 6 }}>
                                Distribuciones asociadas
                              </div>
                              <DistributionTable rows={payment.distributions} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="small">Todavía no hay cobros registrados para esta factura.</div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="small">Este trabajo todavía no tiene facturas o cobros asociados.</div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
