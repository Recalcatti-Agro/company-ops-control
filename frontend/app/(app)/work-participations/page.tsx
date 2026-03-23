"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Investor = { id: number; name: string };
type Job = { id: number; client: string; status: "PENDING" | "DONE" | "INVOICED" | "COLLECTED" | "CANCELLED" };
type JobCollection = {
  id: number;
  job: number | null;
  jobs: number[];
  collection_date: string;
  amount_ars: string;
  fx_ars_usd: string;
  amount_usd: string;
  collected_currency: "USD" | "ARS" | null;
  collected_amount_original: string | null;
  collected_fx_ars_usd: string | null;
  converted_to_usd: boolean;
  collected_amount_usd: string | null;
  tax_loss_usd: string;
  status: "BILLED" | "COLLECTED";
};
type Distribution = {
  id: number;
  collection: number;
  investor: number | null;
  kind: "FIELD_TEAM" | "SHAREHOLDER" | "REINVESTMENT";
  percentage: string | null;
  amount_usd: string;
  work_amount_usd?: string;
  shareholder_amount_usd?: string;
  reinvest_to_cash_usd: string;
};
type DistributionPreview = {
  collection_id: number;
  target_usd: number;
  field_team_percentage: number;
  field_team_total_usd: number;
  shareholder_total_usd: number;
  percentage_reference_date: string;
  field_team_rows: { investor_id: number; investor_name: string; amount_usd: number }[];
  shareholder_rows: { investor_id: number; investor_name: string; company_percentage: number; amount_usd: number }[];
  investor_rows: {
    investor_id: number;
    investor_name: string;
    company_percentage: number;
    worker_amount_usd: number;
    shareholder_amount_usd: number;
    total_amount_usd: number;
  }[];
};
type FxQuote = {
  requested_date: string;
  rate_date: string;
  ars_per_usd: number;
  usd_per_ars: number;
  source: string;
};

export default function WorkParticipationsPage() {
  const router = useRouter();
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [collections, setCollections] = useState<JobCollection[]>([]);
  const [rows, setRows] = useState<Distribution[]>([]);
  const [error, setError] = useState("");
  const [distributionCollectionId, setDistributionCollectionId] = useState<number | null>(null);
  const [fieldTeamPercentageInput, setFieldTeamPercentageInput] = useState("0");
  const [workerInvestorIds, setWorkerInvestorIds] = useState<number[]>([]);
  const [distributionPreview, setDistributionPreview] = useState<DistributionPreview | null>(null);
  const [withdrawalsByInvestor, setWithdrawalsByInvestor] = useState<Record<number, string>>({});

  const [search, setSearch] = useState("");
  const [expandedCollections, setExpandedCollections] = useState<number[]>([]);
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<"ALL" | "BILLED" | "COLLECTED">("ALL");
  const [collectionClientFilter, setCollectionClientFilter] = useState<string>("ALL");

  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null);
  const [editCollectionDate, setEditCollectionDate] = useState("");
  const [editCollectionAmountArs, setEditCollectionAmountArs] = useState("");
  const [editCollectionAmountUsd, setEditCollectionAmountUsd] = useState("");
  const [editCollectionStatus, setEditCollectionStatus] = useState<"BILLED" | "COLLECTED">("BILLED");
  const [editCollectionCollectedUsd, setEditCollectionCollectedUsd] = useState("");

  const [collectingCollectionId, setCollectingCollectionId] = useState<number | null>(null);
  const [collectingDate, setCollectingDate] = useState(new Date().toISOString().slice(0, 10));
  const [collectingCurrency, setCollectingCurrency] = useState<"USD" | "ARS">("ARS");
  const [collectingAmountInput, setCollectingAmountInput] = useState("");
  const [collectingFxArsUsd, setCollectingFxArsUsd] = useState("");
  const [collectingConvertedToUsd, setCollectingConvertedToUsd] = useState(true);
  const [collectingFxQuote, setCollectingFxQuote] = useState<FxQuote | null>(null);
  const [activeCollectionActionId, setActiveCollectionActionId] = useState<number | null>(null);

  const load = async () => {
    const [investorsData, jobsData, collectionsData, rowsData] = await Promise.all([
      apiFetch<Investor[]>("/investors/"),
      apiFetch<Job[]>("/jobs/"),
      apiFetch<JobCollection[]>("/job-collections/"),
      apiFetch<Distribution[]>("/job-distributions/"),
    ]);
    setInvestors(investorsData);
    setJobs(jobsData);
    setCollections(collectionsData);
    setRows(rowsData);
  };

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load().catch(() => setError("No se pudo cargar datos"));
  }, [router]);

  const investorById = useMemo(() => Object.fromEntries(investors.map((i) => [i.id, i.name])), [investors]);
  const investorChipClass = (investorId: number) => `chip-person-${((investorId - 1) % 6) + 1}`;
  const jobById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, `Trabajo #${j.id}`])), [jobs]);
  const formatNumber = (value: number, digits = 2) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  const parseLooseNumber = (raw: string) => {
    const value = String(raw || "").trim().replace(/\s/g, "");
    if (!value) return 0;
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) return Number(value.replace(/,/g, ""));
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)) return Number(value.replace(/\./g, "").replace(",", "."));
    return Number(value.replace(",", "."));
  };

  const getCollectionJobIds = (c: JobCollection) => {
    if (c.jobs?.length) return c.jobs;
    return c.job ? [c.job] : [];
  };

  const getCollectionJobsLabel = (c: JobCollection) => {
    const ids = getCollectionJobIds(c);
    if (!ids.length) return "Sin trabajo";
    return ids.map((id) => jobById[id] || `#${id}`).join(" + ");
  };

  const getCollectionClientsLabel = (c: JobCollection) => {
    const ids = getCollectionJobIds(c);
    const clients = Array.from(
      new Set(
        ids
          .map((id) => jobs.find((j) => j.id === id)?.client?.trim())
          .filter((value): value is string => Boolean(value))
      )
    );
    if (!clients.length) return "-";
    return clients.join(" + ");
  };

  const collectionLabelById = useMemo(
    () =>
      Object.fromEntries(
        collections.map((c) => [c.id, `${getCollectionJobsLabel(c)} - ${c.collection_date} - USD ${formatNumber(Number(c.amount_usd || 0))}`])
      ),
    [collections, jobById, formatNumber]
  );

  const onDelete = async (id: number) => {
    setError("");
    try {
      await apiFetch(`/job-distributions/${id}/`, { method: "DELETE" });
      await load();
    } catch {
      setError("No se pudo eliminar la distribución");
    }
  };

  const onStartDistribution = (collectionId: number) => {
    setDistributionCollectionId(collectionId);
    setFieldTeamPercentageInput("0");
    setWorkerInvestorIds([]);
    setDistributionPreview(null);
    setWithdrawalsByInvestor({});
  };

  const onToggleWorker = (investorId: number) => {
    setWorkerInvestorIds((prev) => (prev.includes(investorId) ? prev.filter((id) => id !== investorId) : [...prev, investorId]));
  };

  const onCalculateDistribution = async () => {
    if (!distributionCollectionId) return;
    setError("");
    try {
      const preview = await apiFetch<DistributionPreview>(`/job-collections/${distributionCollectionId}/distribution-preview/`, {
        method: "POST",
        body: JSON.stringify({
          field_team_percentage: fieldTeamPercentageInput || "0",
          worker_investor_ids: workerInvestorIds,
        }),
      });
      setDistributionPreview(preview);
      const defaults: Record<number, string> = {};
      preview.investor_rows.forEach((row) => {
        defaults[row.investor_id] = "0";
      });
      setWithdrawalsByInvestor(defaults);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo calcular la distribución");
    }
  };

  const onApplyDistribution = async () => {
    if (!distributionCollectionId || !distributionPreview) return;
    setError("");
    try {
      await apiFetch(`/job-collections/${distributionCollectionId}/apply-distribution/`, {
        method: "POST",
        body: JSON.stringify({
          field_team_percentage: fieldTeamPercentageInput || "0",
          worker_investor_ids: workerInvestorIds,
          withdrawals_by_investor: withdrawalsByInvestor,
        }),
      });
      setDistributionCollectionId(null);
      setDistributionPreview(null);
      setWithdrawalsByInvestor({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aplicar la distribución");
    }
  };

  const onStartCollecting = (c: JobCollection) => {
    setCollectingCollectionId(c.id);
    setCollectingDate(new Date().toISOString().slice(0, 10));
    setCollectingCurrency("ARS");
    setCollectingAmountInput(Number(c.amount_usd || 0).toFixed(2));
    setCollectingFxArsUsd(c.fx_ars_usd || "");
    setCollectingConvertedToUsd(c.converted_to_usd ?? true);
  };

  useEffect(() => {
    if (!collectingCollectionId) return;
    apiFetch<FxQuote>(`/fx/ars-usd/?date=${collectingDate}`)
      .then((quote) => {
        setCollectingFxQuote(quote);
        if (collectingCurrency === "ARS") setCollectingFxArsUsd(quote.ars_per_usd.toFixed(4));
      })
      .catch(() => setError("No se pudo obtener tipo de cambio para la fecha de cobro"));
  }, [collectingCollectionId, collectingDate, collectingCurrency]);

  const collectingAmountUsd = useMemo(() => {
    const amount = parseLooseNumber(collectingAmountInput);
    if (!Number.isFinite(amount)) return 0;
    if (collectingCurrency === "USD") return amount;
    const fx = Number(collectingFxArsUsd || 0);
    if (!Number.isFinite(fx) || fx <= 0) return 0;
    return amount / fx;
  }, [collectingAmountInput, collectingCurrency, collectingFxArsUsd]);

  const onConfirmCollected = async () => {
    if (!collectingCollectionId) return;
    const c = collections.find((item) => item.id === collectingCollectionId);
    if (!c) return;

    const billedUsd = Number(c.amount_usd || 0);
    const billedArs = Number(c.amount_ars || 0);
    const collectedOriginal = parseLooseNumber(collectingAmountInput);
    const collected = Number(collectingAmountUsd || 0);
    if (!collected || collected <= 0) {
      setError("Ingresá un monto cobrado válido.");
      return;
    }
    if (collectingCurrency === "USD" && collected > billedUsd) {
      setError("El monto cobrado no puede superar el facturado.");
      return;
    }
    if (collectingCurrency === "ARS" && collectedOriginal > billedArs) {
      setError("El monto cobrado en ARS no puede superar el facturado.");
      return;
    }

    setError("");
    try {
      await apiFetch(`/job-collections/${collectingCollectionId}/mark-collected/`, {
        method: "POST",
        body: JSON.stringify({
          collected_amount_usd: collected.toFixed(2),
          collected_currency: collectingCurrency,
          collected_amount_original: collectedOriginal.toFixed(2),
          collected_fx_ars_usd: collectingCurrency === "ARS" ? collectingFxArsUsd : null,
          converted_to_usd: collectingConvertedToUsd,
          collection_date: collectingDate,
        }),
      });
      setCollectingCollectionId(null);
      setCollectingAmountInput("");
      setCollectingFxQuote(null);
      setCollectingFxArsUsd("");
      setCollectingConvertedToUsd(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo marcar como cobrado");
    }
  };

  const onStartEditCollection = (c: JobCollection) => {
    setEditingCollectionId(c.id);
    setEditCollectionDate(c.collection_date);
    setEditCollectionAmountArs(c.amount_ars || "0");
    setEditCollectionAmountUsd(c.amount_usd || "0");
    setEditCollectionStatus(c.status);
    setEditCollectionCollectedUsd(c.collected_amount_usd || c.amount_usd || "0");
  };

  const onSaveEditCollection = async () => {
    if (!editingCollectionId) return;
    setError("");
    try {
      const payload: Record<string, string> = {
        collection_date: editCollectionDate,
        amount_ars: editCollectionAmountArs || "0",
        amount_usd: editCollectionAmountUsd || "0",
        status: editCollectionStatus,
      };
      if (editCollectionStatus === "COLLECTED") payload.collected_amount_usd = editCollectionCollectedUsd || editCollectionAmountUsd || "0";

      await apiFetch(`/job-collections/${editingCollectionId}/`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setEditingCollectionId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo editar la facturación");
    }
  };

  const onDeleteCollection = async (collectionId: number) => {
    setError("");
    try {
      await apiFetch(`/job-collections/${collectionId}/`, { method: "DELETE" });
      if (distributionCollectionId === collectionId) setDistributionCollectionId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar la facturación");
    }
  };

  const expandedDistributionRows = useMemo(() => {
    const out: Array<
      Distribution & {
        display_id: string;
        display_kind: "WORK" | "SHAREHOLDER" | "FIELD_TEAM" | "REINVESTMENT";
        display_percentage: string | null;
        display_amount_usd: number;
        display_reinvest_usd: number;
        display_withdraw_usd: number;
      }
    > = [];

    for (const row of rows) {
      const workAmount = Number(row.work_amount_usd || 0);
      const shareholderAmount = Number(row.shareholder_amount_usd || 0);
      const reinvest = Number(row.reinvest_to_cash_usd || 0);
      const withdraw = Number(row.amount_usd || 0) - reinvest;

      if (row.kind === "SHAREHOLDER" && (workAmount > 0 || shareholderAmount > 0)) {
        if (workAmount > 0) {
          out.push({
            ...row,
            display_id: `${row.id}-work`,
            display_kind: "WORK",
            display_percentage: null,
            display_amount_usd: workAmount,
            display_reinvest_usd: 0,
            display_withdraw_usd: 0,
          });
        }
        out.push({
          ...row,
          display_id: `${row.id}-shareholder`,
          display_kind: "SHAREHOLDER",
          display_percentage: row.percentage ?? null,
          display_amount_usd: shareholderAmount,
          display_reinvest_usd: reinvest,
          display_withdraw_usd: withdraw,
        });
        continue;
      }

      out.push({
        ...row,
        display_id: `${row.id}-base`,
        display_kind: row.kind,
        display_percentage: row.kind === "SHAREHOLDER" ? row.percentage ?? null : null,
        display_amount_usd: Number(row.amount_usd || 0),
        display_reinvest_usd: reinvest,
        display_withdraw_usd: withdraw,
      });
    }

    return out;
  }, [rows]);

  const filteredRows = useMemo(() => {
    return expandedDistributionRows.filter((row) => {
      const text = `${collectionLabelById[row.collection] || ""} ${investorById[row.investor || 0] || "Equipo"} ${row.display_kind}`.toLowerCase();
      return text.includes(search.toLowerCase());
    });
  }, [expandedDistributionRows, search, collectionLabelById, investorById]);

  const distributionGroups = useMemo(() => {
    const map: Record<number, typeof filteredRows> = {};
    for (const row of filteredRows) {
      if (!map[row.collection]) map[row.collection] = [];
      map[row.collection].push(row);
    }
    return Object.entries(map)
      .map(([collectionId, groupRows]) => ({
        collectionId: Number(collectionId),
        rows: groupRows,
        label: collectionLabelById[Number(collectionId)] || `Cobro #${collectionId}`,
      }))
      .sort((a, b) => b.collectionId - a.collectionId);
  }, [filteredRows, collectionLabelById]);

  useEffect(() => {
    if (!search.trim()) return;
    setExpandedCollections(distributionGroups.map((g) => g.collectionId));
  }, [search, distributionGroups]);

  const toggleCollectionGroup = (collectionId: number) => {
    setExpandedCollections((prev) => (prev.includes(collectionId) ? prev.filter((id) => id !== collectionId) : [...prev, collectionId]));
  };

  const visibleCollections = useMemo(() => {
    return [...collections]
      .sort((a, b) => (a.collection_date === b.collection_date ? b.id - a.id : b.collection_date.localeCompare(a.collection_date)))
      .filter((c) => {
        const statusOk = collectionStatusFilter === "ALL" || c.status === collectionStatusFilter;
        const clientLabel = getCollectionClientsLabel(c);
        const clientOk = collectionClientFilter === "ALL" || clientLabel === collectionClientFilter;
        return statusOk && clientOk;
      });
  }, [collections, collectionStatusFilter, collectionClientFilter, jobById]);

  const collectionClientOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const c of collections) {
      const label = getCollectionClientsLabel(c);
      if (label && label !== "-") unique.add(label);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, "es"));
  }, [collections, jobs]);

  const collectionTotals = useMemo(() => {
    let billedArs = 0;
    let billedUsd = 0;
    let collectedUsd = 0;
    let taxUsd = 0;
    let collectedOriginalArs = 0;
    let collectedOriginalUsd = 0;

    for (const c of visibleCollections) {
      billedArs += Number(c.amount_ars || 0);
      billedUsd += Number(c.amount_usd || 0);
      collectedUsd += Number(c.collected_amount_usd || 0);
      taxUsd += Number(c.tax_loss_usd || 0);

      if (c.collected_amount_original) {
        if (c.collected_currency === "ARS") collectedOriginalArs += Number(c.collected_amount_original);
        if (c.collected_currency === "USD") collectedOriginalUsd += Number(c.collected_amount_original);
      }
    }

    return {
      billedArs,
      billedUsd,
      collectedUsd,
      taxUsd,
      collectedOriginalArs,
      collectedOriginalUsd,
    };
  }, [visibleCollections]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h2>Facturas y cobros</h2>
        {error ? <p style={{ color: "#b42318", margin: 0 }}>{error}</p> : null}
        <p className="small" style={{ marginBottom: 10 }}>
          La facturación se realiza en la pantalla <strong>Trabajos</strong>. Acá podés cobrar, editar, eliminar y distribuir.
        </p>

        <h3 style={{ marginTop: 16 }}>Cobros registrados</h3>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            marginBottom: 10,
            padding: 10,
            border: "1px solid var(--line)",
            borderRadius: 12,
            background: "var(--surface)",
          }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="small">Estado:</span>
            {[
              { value: "ALL", label: "Todos" },
              { value: "BILLED", label: "Facturado" },
              { value: "COLLECTED", label: "Cobrado" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`chip-label ${collectionStatusFilter === opt.value ? "chip-status status-completed" : ""}`}
                onClick={() => setCollectionStatusFilter(opt.value as "ALL" | "BILLED" | "COLLECTED")}
                style={{ cursor: "pointer", border: "1px solid var(--line)" }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 260 }}>
            <span className="small">Cliente:</span>
            <select value={collectionClientFilter} onChange={(e) => setCollectionClientFilter(e.target.value)} style={{ minWidth: 220 }}>
              <option value="ALL">Todos</option>
              {collectionClientOptions.map((client) => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => {
              setCollectionStatusFilter("ALL");
              setCollectionClientFilter("ALL");
            }}
            style={{ padding: "8px 10px" }}
          >
            Limpiar
          </button>

          <span className="small" style={{ marginLeft: "auto" }}>
            {visibleCollections.length} resultados
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Trabajos</th>
                <th>Cliente</th>
                <th>Estado cobro</th>
                <th>ARS</th>
                <th>USD facturado</th>
                <th>Cobro orig.</th>
                <th>USD cobrado</th>
                <th>USD impuestos</th>
                <th>Conv. USD</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleCollections.map((c) => (
                <tr
                  key={c.id}
                  className="row-clickable"
                  onClick={() => setActiveCollectionActionId((prev) => (prev === c.id ? null : c.id))}
                >
                  <td>{c.collection_date}</td>
                  <td>{getCollectionJobsLabel(c)}</td>
                  <td>{getCollectionClientsLabel(c)}</td>
                  <td>
                    <span className={`chip-label chip-status ${c.status === "COLLECTED" ? "status-collected" : "status-billed"}`}>
                      {c.status === "COLLECTED" ? "Cobrado" : "Facturado"}
                    </span>
                  </td>
                  <td>{formatNumber(Number(c.amount_ars || 0))}</td>
                  <td>{formatNumber(Number(c.amount_usd || 0))}</td>
                  <td>{c.collected_amount_original ? `${c.collected_currency || ""} ${formatNumber(Number(c.collected_amount_original))}` : "-"}</td>
                  <td>{c.collected_amount_usd ? formatNumber(Number(c.collected_amount_usd)) : "-"}</td>
                  <td>{formatNumber(Number(c.tax_loss_usd || 0))}</td>
                  <td>{c.status === "COLLECTED" ? (c.converted_to_usd ? "Sí" : "No") : "-"}</td>
                  <td>
                    <div style={{ display: "grid", justifyItems: "end", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                      {activeCollectionActionId === c.id ? (
                        <div
                          style={{
                            display: "grid",
                            gap: 6,
                            width: "100%",
                            minWidth: 180,
                          }}
                        >
                          {c.status === "COLLECTED" ? (
                            <button className="btn btn-secondary" type="button" onClick={() => onStartDistribution(c.id)}>
                              Distribuir
                            </button>
                          ) : (
                            <button className="btn btn-secondary" type="button" onClick={() => onStartCollecting(c)}>
                              Cobrar
                            </button>
                          )}
                          <button className="btn btn-secondary" type="button" onClick={() => onStartEditCollection(c)}>
                            Editar
                          </button>
                          <button className="btn btn-secondary" type="button" onClick={() => onDeleteCollection(c.id)}>
                            Eliminar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!visibleCollections.length ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", color: "var(--muted)" }}>
                    No hay cobros para mostrar
                  </td>
                </tr>
              ) : null}
            </tbody>
            {visibleCollections.length ? (
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ fontWeight: 700 }}>Totales</td>
                  <td style={{ fontWeight: 700 }}>{formatNumber(collectionTotals.billedArs)}</td>
                  <td style={{ fontWeight: 700 }}>{formatNumber(collectionTotals.billedUsd)}</td>
                  <td style={{ fontWeight: 700 }}>
                    {collectionTotals.collectedOriginalArs > 0 ? `$${formatNumber(collectionTotals.collectedOriginalArs)}` : ""}
                    {collectionTotals.collectedOriginalArs > 0 && collectionTotals.collectedOriginalUsd > 0 ? " · " : ""}
                    {collectionTotals.collectedOriginalUsd > 0 ? `U$S ${formatNumber(collectionTotals.collectedOriginalUsd)}` : ""}
                    {collectionTotals.collectedOriginalArs <= 0 && collectionTotals.collectedOriginalUsd <= 0 ? "-" : ""}
                  </td>
                  <td style={{ fontWeight: 700 }}>{formatNumber(collectionTotals.collectedUsd)}</td>
                  <td style={{ fontWeight: 700 }}>{formatNumber(collectionTotals.taxUsd)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Distribuciones por cobro</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" />
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() =>
              setExpandedCollections((prev) =>
                prev.length === distributionGroups.length ? [] : distributionGroups.map((g) => g.collectionId)
              )
            }
          >
            {expandedCollections.length === distributionGroups.length ? "Colapsar todo" : "Expandir todo"}
          </button>
        </div>
        <div className="accordion-list">
          {distributionGroups.map((group) => {
            const isOpen = expandedCollections.includes(group.collectionId);
            return (
              <div key={group.collectionId} className="month-accordion">
                <button className="month-accordion-header" type="button" onClick={() => toggleCollectionGroup(group.collectionId)}>
                  <span>{group.label}</span>
                  <span>{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Inversor</th>
                          <th>%</th>
                          <th>USD total</th>
                          <th>USD caja</th>
                          <th>USD retiro</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.display_id}>
                            <td>{row.display_kind}</td>
                            <td>
                              <span className={`chip-label chip-person ${row.investor ? investorChipClass(row.investor) : "chip-person-cash"}`}>
                                {row.investor ? investorById[row.investor] || row.investor : "Equipo campo"}
                              </span>
                            </td>
                            <td>{row.display_percentage ? `${Number(row.display_percentage).toFixed(2)}%` : "-"}</td>
                            <td>{formatNumber(Number(row.display_amount_usd || 0))}</td>
                            <td>{formatNumber(Number(row.display_reinvest_usd || 0))}</td>
                            <td>{formatNumber(Number(row.display_withdraw_usd || 0))}</td>
                            <td>
                              <div className="row" style={{ justifyContent: "flex-end" }}>
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
                ) : null}
              </div>
            );
          })}
          {!distributionGroups.length ? (
            <div className="small" style={{ padding: "6px 2px" }}>
              No hay distribuciones para mostrar
            </div>
          ) : null}
        </div>
      </section>

      {editingCollectionId ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={() => setEditingCollectionId(null)}
        >
          <div className="card" style={{ width: "min(640px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Editar facturación</h3>
            <div className="form">
              <input type="date" value={editCollectionDate} onChange={(e) => setEditCollectionDate(e.target.value)} />
              <input value={editCollectionAmountArs} onChange={(e) => setEditCollectionAmountArs(e.target.value)} placeholder="Monto ARS" />
              <input value={editCollectionAmountUsd} onChange={(e) => setEditCollectionAmountUsd(e.target.value)} placeholder="Monto USD" />
              <select value={editCollectionStatus} onChange={(e) => setEditCollectionStatus(e.target.value as "BILLED" | "COLLECTED")}>
                <option value="BILLED">Facturado</option>
                <option value="COLLECTED">Cobrado</option>
              </select>
              {editCollectionStatus === "COLLECTED" ? (
                <input value={editCollectionCollectedUsd} onChange={(e) => setEditCollectionCollectedUsd(e.target.value)} placeholder="USD cobrado final" />
              ) : null}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="button" onClick={onSaveEditCollection}>
                Guardar cambios
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => setEditingCollectionId(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {collectingCollectionId ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={() => setCollectingCollectionId(null)}
        >
          <div className="card" style={{ width: "min(560px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Registrar cobro final</h3>
            <p className="small" style={{ marginTop: 0 }}>
              Si cobrás en ARS, cargá el monto en pesos y el tipo de cambio al que compraste USD.
            </p>
            <div className="form">
              <div className="small">Fecha en que se cobró</div>
              <input type="date" value={collectingDate} onChange={(e) => setCollectingDate(e.target.value)} />
              <div className="small">Moneda en que recibiste el cobro</div>
              <select value={collectingCurrency} onChange={(e) => setCollectingCurrency(e.target.value as "USD" | "ARS")}>
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
              <div className="small">{collectingCurrency === "USD" ? "Monto cobrado en USD" : "Monto cobrado en ARS"}</div>
              <input value={collectingAmountInput} onChange={(e) => setCollectingAmountInput(e.target.value)} placeholder="Monto cobrado final" />
              {collectingCurrency === "ARS" ? (
                <>
                  <div className="small">Tipo de cambio ARS/USD para esa fecha (automático, editable)</div>
                  <input
                    value={collectingFxArsUsd}
                    onChange={(e) => setCollectingFxArsUsd(e.target.value)}
                    placeholder="TC ARS/USD"
                  />
                </>
              ) : null}
              <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={collectingConvertedToUsd}
                  onChange={(e) => setCollectingConvertedToUsd(e.target.checked)}
                />
                Finalmente convertido a USD
              </label>
              <div className="small">Monto cobrado equivalente en USD (automático)</div>
              <input value={collectingAmountUsd ? collectingAmountUsd.toFixed(2) : ""} readOnly placeholder="USD cobrado" />
              <input
                value={(() => {
                  const col = collections.find((c) => c.id === collectingCollectionId);
                  const billed = Number(col?.amount_usd || 0);
                  const collected = Number(collectingAmountUsd || 0);
                  const tax = billed - collected;
                  return Number.isFinite(tax) && tax > 0 ? tax.toFixed(2) : "0.00";
                })()}
                readOnly
                placeholder="USD impuestos/perdida (auto)"
              />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="button" onClick={onConfirmCollected}>
                Confirmar cobro
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => setCollectingCollectionId(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {distributionCollectionId ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={() => setDistributionCollectionId(null)}
        >
          <div className="card" style={{ width: "min(760px, 100%)", maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Distribuir cobro</h3>
            <p className="small" style={{ marginTop: 0 }}>
              1) Definí % para equipo de campo. 2) Elegí quiénes trabajaron. 3) Sobre el resto se calcula por % empresa y definís retiro por inversor.
            </p>
            <div className="form">
              <div className="small">Porcentaje para equipo de campo</div>
              <input
                value={fieldTeamPercentageInput}
                onChange={(e) => setFieldTeamPercentageInput(e.target.value)}
                placeholder="% equipo campo"
              />
              <div className="small">Quiénes trabajaron</div>
              <div className="participant-grid">
                {investors.map((inv) => (
                  <label key={inv.id} className="participant-item">
                    <input
                      className="participant-check"
                      type="checkbox"
                      checked={workerInvestorIds.includes(inv.id)}
                      onChange={() => onToggleWorker(inv.id)}
                    />
                    <span>{inv.name}</span>
                  </label>
                ))}
              </div>
              <button className="btn btn-secondary" type="button" onClick={onCalculateDistribution}>
                Calcular distribución
              </button>
            </div>

            {distributionPreview ? (
              <div style={{ marginTop: 14 }}>
                <p className="small" style={{ margin: "0 0 8px 0" }}>
                  Cobrado USD: <strong>{formatNumber(distributionPreview.target_usd)}</strong> | Equipo campo USD:{" "}
                  <strong>{formatNumber(distributionPreview.field_team_total_usd)}</strong> | Accionistas USD:{" "}
                  <strong>{formatNumber(distributionPreview.shareholder_total_usd)}</strong>
                </p>
                <p className="small" style={{ margin: "0 0 8px 0" }}>
                  % empresa calculado al: <strong>{distributionPreview.percentage_reference_date}</strong>
                </p>
                <h4 style={{ margin: "10px 0 6px 0" }}>Equipo de campo</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Persona</th>
                        <th>USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distributionPreview.field_team_rows.map((row) => (
                        <tr key={row.investor_id}>
                          <td>{row.investor_name}</td>
                          <td>{formatNumber(row.amount_usd)}</td>
                        </tr>
                      ))}
                      {!distributionPreview.field_team_rows.length ? (
                        <tr>
                          <td colSpan={2}>Sin distribución a equipo de campo</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <h4 style={{ margin: "12px 0 6px 0" }}>Accionistas y retiro/reinversión</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Inversor</th>
                        <th>% empresa</th>
                        <th>USD por accionista</th>
                        <th>USD por trabajo</th>
                        <th>USD total</th>
                        <th>Retira USD</th>
                        <th>Reinvierte USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distributionPreview.investor_rows.map((row) => {
                        const withdraw = Number(withdrawalsByInvestor[row.investor_id] || 0);
                        const cappedWithdraw = Math.max(0, Math.min(withdraw, row.total_amount_usd));
                        const reinvest = row.total_amount_usd - cappedWithdraw;
                        return (
                          <tr key={row.investor_id}>
                            <td>{row.investor_name}</td>
                            <td>{row.company_percentage.toFixed(2)}%</td>
                            <td>{formatNumber(row.shareholder_amount_usd)}</td>
                            <td>{formatNumber(row.worker_amount_usd)}</td>
                            <td>{formatNumber(row.total_amount_usd)}</td>
                            <td>
                              <input
                                value={withdrawalsByInvestor[row.investor_id] ?? "0"}
                                onChange={(e) =>
                                  setWithdrawalsByInvestor((prev) => ({
                                    ...prev,
                                    [row.investor_id]: e.target.value,
                                  }))
                                }
                                placeholder="0"
                              />
                            </td>
                            <td>{formatNumber(reinvest)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="button" disabled={!distributionPreview} onClick={onApplyDistribution}>
                Confirmar distribución
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => setDistributionCollectionId(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
