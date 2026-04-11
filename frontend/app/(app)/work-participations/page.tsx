"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getToken } from "@/lib/api";

type Investor = { id: number; name: string };
type Job = { id: number; client: string; status: "PENDING" | "DONE" | "INVOICED" | "COLLECTED" | "CANCELLED" };
type JobCollection = {
  id: number;
  job: number | null;
  jobs: number[];
  parent_collection: number | null;
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
  remaining_amount_usd: string;
  remaining_amount_ars: string;
  has_open_balance: boolean;
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
  field_team_rows: { investor_id: number; investor_name: string; worker_percentage: number; amount_usd: number }[];
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
type CollectionDisplayStatus = "BILLED" | "PARTIAL" | "COLLECTED";
type CollectingMode = "PARTIAL" | "FULL";

export default function WorkParticipationsPage() {
  const router = useRouter();
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [collections, setCollections] = useState<JobCollection[]>([]);
  const [rows, setRows] = useState<Distribution[]>([]);
  const [error, setError] = useState("");
  const [distributionCollectionId, setDistributionCollectionId] = useState<number | null>(null);
  const [workerInvestorIds, setWorkerInvestorIds] = useState<number[]>([]);
  const [workerPercentagesByInvestor, setWorkerPercentagesByInvestor] = useState<Record<number, string>>({});
  const [distributionPreview, setDistributionPreview] = useState<DistributionPreview | null>(null);
  const [withdrawalsByInvestor, setWithdrawalsByInvestor] = useState<Record<number, string>>({});

  const [search, setSearch] = useState("");
  const [expandedCollections, setExpandedCollections] = useState<number[]>([]);
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<"ALL" | CollectionDisplayStatus>("ALL");
  const [collectionClientFilter, setCollectionClientFilter] = useState<string>("ALL");

  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null);
  const [editCollectionDate, setEditCollectionDate] = useState("");
  const [editCollectionAmountArs, setEditCollectionAmountArs] = useState("");
  const [editCollectionAmountUsd, setEditCollectionAmountUsd] = useState("");
  const [editCollectionStatus, setEditCollectionStatus] = useState<"BILLED" | "COLLECTED">("BILLED");
  const [editCollectionCollectedUsd, setEditCollectionCollectedUsd] = useState("");

  const [collectingCollectionId, setCollectingCollectionId] = useState<number | null>(null);
  const [collectingDate, setCollectingDate] = useState(new Date().toISOString().slice(0, 10));
  const [collectingMode, setCollectingMode] = useState<CollectingMode>("FULL");
  const [collectingCompleteAsTax, setCollectingCompleteAsTax] = useState(false);
  const [collectingAmountInput, setCollectingAmountInput] = useState("");
  const [collectingFxArsUsd, setCollectingFxArsUsd] = useState("");
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

  const invoiceRows = useMemo(() => {
    const baseCollections = collections.filter((c) => !c.parent_collection);

    return baseCollections
      .map((invoice) => {
        const relatedPayments = [...collections.filter((c) => c.parent_collection === invoice.id)].sort((a, b) =>
          a.collection_date === b.collection_date ? b.id - a.id : b.collection_date.localeCompare(a.collection_date)
        );
        const paymentRows = relatedPayments.length ? relatedPayments : invoice.status === "COLLECTED" ? [invoice] : [];
        const invoiceAmountArs = Number(invoice.amount_ars || 0);
        const invoiceAmountUsd = Number(invoice.amount_usd || 0);
        const collectedTotalUsd = paymentRows.reduce((acc, payment) => acc + Number(payment.collected_amount_usd || 0), 0);
        const remainingAmountArs = Number(invoice.remaining_amount_ars || 0);
        const remainingAmountUsd = Number(invoice.remaining_amount_usd || 0);
        const taxTotalUsd = paymentRows.reduce((acc, payment) => acc + Number(payment.tax_loss_usd || 0), 0);

        let displayStatus: CollectionDisplayStatus = "BILLED";
        if (invoice.status === "COLLECTED" || (paymentRows.length > 0 && remainingAmountUsd <= 0)) {
          displayStatus = "COLLECTED";
        } else if (paymentRows.length > 0) {
          displayStatus = "PARTIAL";
        }

        return {
          invoice,
          paymentRows,
          jobsLabel: getCollectionJobsLabel(invoice),
          clientsLabel: getCollectionClientsLabel(invoice),
          invoiceAmountArs,
          invoiceAmountUsd,
          collectedTotalUsd,
          remainingAmountArs,
          remainingAmountUsd,
          taxTotalUsd,
          displayStatus,
          canCollect: remainingAmountUsd > 0,
        };
      })
      .sort((a, b) =>
        a.invoice.collection_date === b.invoice.collection_date
          ? b.invoice.id - a.invoice.id
          : b.invoice.collection_date.localeCompare(a.invoice.collection_date)
      )
      .filter((row) => {
        const statusOk = collectionStatusFilter === "ALL" || row.displayStatus === collectionStatusFilter;
        const clientOk = collectionClientFilter === "ALL" || row.clientsLabel === collectionClientFilter;
        return statusOk && clientOk;
      });
  }, [collections, collectionStatusFilter, collectionClientFilter, jobById]);

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
    setWorkerInvestorIds([]);
    setWorkerPercentagesByInvestor({});
    setDistributionPreview(null);
    setWithdrawalsByInvestor({});
  };

  const onToggleWorker = (investorId: number) => {
    setWorkerInvestorIds((prev) => {
      const exists = prev.includes(investorId);
      const next = exists ? prev.filter((id) => id !== investorId) : [...prev, investorId];
      setWorkerPercentagesByInvestor((current) => {
        const updated = { ...current };
        if (exists) {
          delete updated[investorId];
        } else {
          updated[investorId] = updated[investorId] || "";
        }
        return updated;
      });
      setDistributionPreview(null);
      setWithdrawalsByInvestor({});
      return next;
    });
  };

  const fieldTeamPercentageTotal = useMemo(
    () => workerInvestorIds.reduce((acc, investorId) => acc + parseLooseNumber(workerPercentagesByInvestor[investorId] || "0"), 0),
    [workerInvestorIds, workerPercentagesByInvestor]
  );

  const buildWorkerPercentagesPayload = () => {
    if (fieldTeamPercentageTotal <= 0) return {};
    return Object.fromEntries(workerInvestorIds.map((investorId) => [investorId, workerPercentagesByInvestor[investorId] || "0"]));
  };

  const onCalculateDistribution = async () => {
    if (!distributionCollectionId) return;
    setError("");
    if (workerInvestorIds.length) {
      if (fieldTeamPercentageTotal > 100.01) {
        setError("La suma de los % de trabajo no puede superar 100.");
        return;
      }
      if (workerInvestorIds.some((investorId) => parseLooseNumber(workerPercentagesByInvestor[investorId] || "0") <= 0)) {
        setError("Cada persona seleccionada debe tener un % de trabajo mayor a 0.");
        return;
      }
    }
    try {
      const preview = await apiFetch<DistributionPreview>(`/job-collections/${distributionCollectionId}/distribution-preview/`, {
        method: "POST",
        body: JSON.stringify({
          field_team_percentage: fieldTeamPercentageTotal.toFixed(2),
          worker_investor_ids: workerInvestorIds,
          worker_percentages: buildWorkerPercentagesPayload(),
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
    if (workerInvestorIds.length) {
      if (fieldTeamPercentageTotal > 100.01) {
        setError("La suma de los % de trabajo no puede superar 100.");
        return;
      }
      if (workerInvestorIds.some((investorId) => parseLooseNumber(workerPercentagesByInvestor[investorId] || "0") <= 0)) {
        setError("Cada persona seleccionada debe tener un % de trabajo mayor a 0.");
        return;
      }
    }
    try {
      await apiFetch(`/job-collections/${distributionCollectionId}/apply-distribution/`, {
        method: "POST",
        body: JSON.stringify({
          field_team_percentage: fieldTeamPercentageTotal.toFixed(2),
          worker_investor_ids: workerInvestorIds,
          worker_percentages: buildWorkerPercentagesPayload(),
          withdrawals_by_investor: withdrawalsByInvestor,
        }),
      });
      setDistributionCollectionId(null);
      setDistributionPreview(null);
      setWorkerPercentagesByInvestor({});
      setWithdrawalsByInvestor({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aplicar la distribución");
    }
  };

  const onStartCollecting = (c: JobCollection) => {
    setCollectingCollectionId(c.id);
    setCollectingDate(new Date().toISOString().slice(0, 10));
    setCollectingMode("FULL");
    setCollectingCompleteAsTax(false);
    setCollectingAmountInput("");
    setCollectingFxArsUsd(c.fx_ars_usd || "");
  };

  useEffect(() => {
    if (!collectingCollectionId) return;
    apiFetch<{ ars_per_usd: number }>(`/fx/ars-usd/?date=${collectingDate}`)
      .then((quote) => {
        setCollectingFxArsUsd(quote.ars_per_usd.toFixed(4));
      })
      .catch(() => setError("No se pudo obtener tipo de cambio para la fecha de cobro"));
  }, [collectingCollectionId, collectingDate]);

  const collectingAmountUsd = useMemo(() => {
    const amount = parseLooseNumber(collectingAmountInput);
    if (!Number.isFinite(amount)) return 0;
    const fx = Number(collectingFxArsUsd || 0);
    if (!Number.isFinite(fx) || fx <= 0) return 0;
    return amount / fx;
  }, [collectingAmountInput, collectingFxArsUsd]);

  useEffect(() => {
    if (!collectingCollectionId || collectingMode !== "FULL" || collectingCompleteAsTax) return;
    const collection = collections.find((item) => item.id === collectingCollectionId);
    if (!collection) return;
    const remainingUsd = Number(collection.remaining_amount_usd || 0);
    const fx = parseLooseNumber(collectingFxArsUsd);
    if (!Number.isFinite(fx) || fx <= 0) {
      setCollectingAmountInput("");
      return;
    }
    setCollectingAmountInput((remainingUsd * fx).toFixed(2));
  }, [collectingCollectionId, collectingMode, collectingFxArsUsd, collections, collectingCompleteAsTax]);

  const onConfirmCollected = async () => {
    if (!collectingCollectionId) return;
    const c = collections.find((item) => item.id === collectingCollectionId);
    if (!c) return;

    const remainingUsd = Number(c.remaining_amount_usd || 0);
    const collectedOriginal = parseLooseNumber(collectingAmountInput);
    const collected = Number(collectingAmountUsd || 0);
    if (!collected || collected <= 0) {
      setError("Ingresá un monto cobrado válido.");
      return;
    }
    if (collected > remainingUsd + 0.01) {
      setError("El monto cobrado no puede superar el saldo pendiente.");
      return;
    }
    if (collectingMode === "FULL" && !collectingCompleteAsTax && Math.abs(collected - remainingUsd) > 0.01) {
      setError("Para saldar sin impuestos, el monto debe coincidir con el saldo pendiente.");
      return;
    }

    setError("");
    try {
      await apiFetch(`/job-collections/${collectingCollectionId}/mark-collected/`, {
        method: "POST",
        body: JSON.stringify({
          collected_amount_usd: collected.toFixed(2),
          collected_currency: "ARS",
          collected_amount_original: collectedOriginal.toFixed(2),
          collected_fx_ars_usd: collectingFxArsUsd,
          converted_to_usd: false,
          close_remaining: collectingMode === "FULL",
          collection_date: collectingDate,
        }),
      });
      setCollectingCollectionId(null);
      setCollectingMode("FULL");
      setCollectingCompleteAsTax(false);
      setCollectingAmountInput("");
      setCollectingFxArsUsd("");
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

  const collectionClientOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const c of collections.filter((item) => !item.parent_collection)) {
      const label = getCollectionClientsLabel(c);
      if (label && label !== "-") unique.add(label);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, "es"));
  }, [collections, jobs]);

  const collectionTotals = useMemo(() => {
    let invoiceArs = 0;
    let invoiceUsd = 0;
    let collectedUsd = 0;
    let remainingUsd = 0;
    let taxUsd = 0;

    for (const row of invoiceRows) {
      invoiceArs += row.invoiceAmountArs;
      invoiceUsd += row.invoiceAmountUsd;
      collectedUsd += row.collectedTotalUsd;
      remainingUsd += row.remainingAmountUsd;
      taxUsd += row.taxTotalUsd;
    }

    return {
      invoiceArs,
      invoiceUsd,
      collectedUsd,
      remainingUsd,
      taxUsd,
    };
  }, [invoiceRows]);

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
              { value: "ALL", label: "Todos", cls: "status-active" },
              { value: "BILLED", label: "Facturado", cls: "status-billed" },
              { value: "PARTIAL", label: "C Parcial", cls: "status-partial" },
              { value: "COLLECTED", label: "Cobrado", cls: "status-collected" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`chip-label ${collectionStatusFilter === opt.value ? `chip-status ${opt.cls}` : ""}`}
                onClick={() => setCollectionStatusFilter(opt.value as "ALL" | CollectionDisplayStatus)}
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
            {invoiceRows.length} resultados
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha fact.</th>
                <th>Trabajos</th>
                <th>Cliente</th>
                <th>Estado</th>
                <th>ARS factura</th>
                <th>USD factura</th>
                <th>USD cobrado</th>
                <th>USD resta</th>
                <th>USD impuestos</th>
                <th>Cobros</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoiceRows.map((row) => {
                const isOpen = activeCollectionActionId === row.invoice.id;
                const statusClass =
                  row.displayStatus === "COLLECTED"
                    ? "status-collected"
                    : row.displayStatus === "PARTIAL"
                      ? "status-partial"
                      : "status-billed";
                const statusLabel =
                  row.displayStatus === "COLLECTED"
                    ? "Cobrado"
                    : row.displayStatus === "PARTIAL"
                      ? "C Parcial"
                      : "Facturado";

                return (
                  <Fragment key={row.invoice.id}>
                    <tr
                      className="row-clickable"
                      onClick={() => setActiveCollectionActionId((prev) => (prev === row.invoice.id ? null : row.invoice.id))}
                    >
                      <td>{row.invoice.collection_date}</td>
                      <td>{row.jobsLabel}</td>
                      <td>{row.clientsLabel}</td>
                      <td>
                        <span className={`chip-label chip-status ${statusClass}`}>{statusLabel}</span>
                      </td>
                      <td>{formatNumber(row.invoiceAmountArs)}</td>
                      <td>{formatNumber(row.invoiceAmountUsd)}</td>
                      <td>{formatNumber(row.collectedTotalUsd)}</td>
                      <td>{formatNumber(row.remainingAmountUsd)}</td>
                      <td>{formatNumber(row.taxTotalUsd)}</td>
                      <td>{row.paymentRows.length}</td>
                      <td>
                        <div className="row" style={{ justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-secondary" type="button" onClick={() => setActiveCollectionActionId((prev) => (prev === row.invoice.id ? null : row.invoice.id))}>
                            {isOpen ? "Ocultar" : "Ver"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={11} style={{ background: "var(--surface)" }}>
                          <div style={{ display: "grid", gap: 12, padding: "6px 0" }}>
                            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                              <span className={`chip-label chip-status ${statusClass}`}>{statusLabel}</span>
                              <span className="chip-label">Factura USD {formatNumber(row.invoiceAmountUsd)}</span>
                              <span className="chip-label">Cobrado USD {formatNumber(row.collectedTotalUsd)}</span>
                              <span className="chip-label">Resta USD {formatNumber(row.remainingAmountUsd)}</span>
                              <span className="chip-label">Cobros rel. {row.paymentRows.length}</span>
                            </div>

                            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                              {row.canCollect ? (
                                <button className="btn btn-secondary" type="button" onClick={() => onStartCollecting(row.invoice)}>
                                  Registrar cobro
                                </button>
                              ) : null}
                              <button className="btn btn-secondary" type="button" onClick={() => onStartEditCollection(row.invoice)}>
                                Editar factura
                              </button>
                              <button className="btn btn-secondary" type="button" onClick={() => onDeleteCollection(row.invoice.id)}>
                                Eliminar factura
                              </button>
                            </div>

                            {row.paymentRows.length ? (
                              <div className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Fecha cobro</th>
                                      <th>Cobro ARS</th>
                                      <th>USD cobrado</th>
                                      <th>USD impuestos</th>
                                      <th></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.paymentRows.map((payment) => (
                                      <tr key={payment.id}>
                                        <td>{payment.collection_date}</td>
                                        <td>
                                          {payment.collected_amount_original ? `$ ${formatNumber(Number(payment.collected_amount_original))}` : "-"}
                                        </td>
                                        <td>{payment.collected_amount_usd ? formatNumber(Number(payment.collected_amount_usd)) : "-"}</td>
                                        <td>{formatNumber(Number(payment.tax_loss_usd || 0))}</td>
                                        <td>
                                          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                                            <button className="btn btn-secondary" type="button" onClick={() => onStartDistribution(payment.id)}>
                                              Distribuir
                                            </button>
                                            <button className="btn btn-secondary" type="button" onClick={() => onStartEditCollection(payment)}>
                                              Editar
                                            </button>
                                            <button className="btn btn-secondary" type="button" onClick={() => onDeleteCollection(payment.id)}>
                                              Eliminar
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="small" style={{ color: "var(--muted)" }}>
                                No hay cobros relacionados todavía.
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!invoiceRows.length ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", color: "var(--muted)" }}>
                    No hay facturas para mostrar
                  </td>
                </tr>
              ) : null}
            </tbody>
            {invoiceRows.length ? (
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ fontWeight: 700 }}>Totales</td>
                  <td style={{ fontWeight: 700 }}>{formatNumber(collectionTotals.invoiceArs)}</td>
                  <td style={{ fontWeight: 700 }}>{formatNumber(collectionTotals.invoiceUsd)}</td>
                  <td style={{ fontWeight: 700 }}>{formatNumber(collectionTotals.collectedUsd)}</td>
                  <td style={{ fontWeight: 700 }}>{formatNumber(collectionTotals.remainingUsd)}</td>
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
            <h3 style={{ marginTop: 0 }}>Registrar cobro</h3>
            <p className="small" style={{ marginTop: 0 }}>
              El cobro se registra siempre en pesos. Ingresá el monto cobrado y el tipo de cambio de referencia del día.
            </p>
            <div className="form">
              <div className="small">
                {(() => {
                  const col = collections.find((c) => c.id === collectingCollectionId);
                  const pendingUsd = Number(col?.remaining_amount_usd || 0);
                  return `Saldo pendiente: U$S ${pendingUsd.toFixed(2)}`;
                })()}
              </div>
              <div className="small">Tipo de registro</div>
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  background: "var(--surface)",
                }}
              >
                {[
                  {
                    value: "PARTIAL" as CollectingMode,
                    title: "Cobro parcial",
                    description: "Registrás lo efectivamente cobrado y el resto sigue pendiente.",
                  },
                  {
                    value: "FULL" as CollectingMode,
                    title: "Cobro saldo restante",
                    description: "Cerrás la factura. Si cobrás menos, podés completar la diferencia como impuestos.",
                  },
                ].map((option) => (
                  <label key={option.value} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="collecting-mode"
                      checked={collectingMode === option.value}
                      onChange={() => {
                        setCollectingMode(option.value);
                        if (option.value !== "FULL") setCollectingCompleteAsTax(false);
                      }}
                      style={{ margin: "2px 0 0", flexShrink: 0 }}
                    />
                    <span style={{ display: "grid", gap: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{option.title}</span>
                      <span className="small">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {collectingMode === "FULL" ? (
                <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={collectingCompleteAsTax}
                    onChange={(e) => setCollectingCompleteAsTax(e.target.checked)}
                    style={{ margin: 0 }}
                  />
                  Completar diferencia como impuestos
                </label>
              ) : null}
              <div className="small">Fecha en que se cobró</div>
              <input type="date" value={collectingDate} onChange={(e) => setCollectingDate(e.target.value)} />
              <div className="small">
                {collectingMode === "FULL"
                  ? collectingCompleteAsTax
                    ? "Monto cobrado en pesos"
                    : "Monto para saldar en pesos"
                  : "Monto cobrado en pesos"}
              </div>
              <input
                value={collectingAmountInput}
                onChange={(e) => setCollectingAmountInput(e.target.value)}
                placeholder={collectingMode === "FULL" && !collectingCompleteAsTax ? "Monto calculado automáticamente" : "Monto cobrado"}
                readOnly={collectingMode === "FULL" && !collectingCompleteAsTax}
              />
              <div className="small">Tipo de cambio de referencia ARS/USD</div>
              <input
                value={collectingFxArsUsd}
                onChange={(e) => setCollectingFxArsUsd(e.target.value)}
                placeholder="TC ARS/USD"
              />
              {collectingMode === "FULL" ? (
                <>
                  <div className="small">Impuestos/pérdida a registrar (ARS)</div>
                  <input
                    value={(() => {
                      const col = collections.find((c) => c.id === collectingCollectionId);
                      const billed = Number(col?.remaining_amount_ars || 0);
                      const collected = parseLooseNumber(collectingAmountInput);
                      const tax = collectingCompleteAsTax ? billed - collected : 0;
                      return Number.isFinite(tax) && tax > 0 ? tax.toFixed(2) : "0.00";
                    })()}
                    readOnly
                    placeholder="ARS impuestos/perdida (auto)"
                  />
                </>
              ) : null}
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
              1) Elegí quiénes trabajaron y qué % del cobro total representa cada uno. 2) Sobre el resto se calcula por % empresa y definís retiro por inversor.
            </p>
            <div className="form">
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
              {workerInvestorIds.length ? (
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    padding: 10,
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    background: "var(--surface)",
                  }}
                >
                  <div className="small">Porcentaje del cobro total que representa el trabajo de cada persona</div>
                  {workerInvestorIds.map((investorId) => (
                    <div key={investorId} className="row" style={{ gap: 10, alignItems: "center" }}>
                      <span style={{ minWidth: 160 }}>{investorById[investorId] || `Inversor #${investorId}`}</span>
                      <input
                        value={workerPercentagesByInvestor[investorId] || ""}
                        onChange={(e) =>
                          {
                            setDistributionPreview(null);
                            setWithdrawalsByInvestor({});
                            setWorkerPercentagesByInvestor((prev) => ({
                              ...prev,
                              [investorId]: e.target.value,
                            }));
                          }
                        }
                        placeholder="% del cobro"
                        style={{ maxWidth: 120 }}
                      />
                    </div>
                  ))}
                  <div
                    className="small"
                    style={{
                      color: fieldTeamPercentageTotal > 100.01 ? "#b42318" : "var(--muted)",
                    }}
                  >
                    Total trabajo sobre cobro: {formatNumber(fieldTeamPercentageTotal)}%
                  </div>
                </div>
              ) : null}
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
                        <th>% del cobro</th>
                        <th>USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distributionPreview.field_team_rows.map((row) => (
                        <tr key={row.investor_id}>
                          <td>{row.investor_name}</td>
                          <td>{formatNumber(row.worker_percentage)}%</td>
                          <td>{formatNumber(row.amount_usd)}</td>
                        </tr>
                      ))}
                      {!distributionPreview.field_team_rows.length ? (
                        <tr>
                          <td colSpan={3}>Sin distribución a equipo de campo</td>
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
