"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getAuthSession, getToken } from "@/lib/api";

type Investor = { id: number; name: string };
type Purchase = { id: number; concept: string };
type Job = { id: number; client: string; work_type: string };
type PaymentObligation = {
  id: number;
  concept: string;
  source: "MANUAL" | "PURCHASE_INSTALLMENT";
  purchase: number | null;
  installment_number: number | null;
  installment_total: number | null;
  due_date: string;
  status: string;
};
type FxQuote = {
  requested_date: string;
  rate_date: string;
  ars_per_usd: number;
  usd_per_ars: number;
  source: string;
};

export default function QuickExpensePage() {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [paidBy, setPaidBy] = useState<"INVESTOR" | "CASH">("INVESTOR");
  const [payerInvestor, setPayerInvestor] = useState<number | "">("");
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [obligations, setObligations] = useState<PaymentObligation[]>([]);
  const [purchase, setPurchase] = useState<number | "">("");
  const [job, setJob] = useState<number | "">("");
  const [paymentObligation, setPaymentObligation] = useState<number | "">("");
  const [showExtra, setShowExtra] = useState(false);
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [sessionInvestorId, setSessionInvestorId] = useState<number | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }

    const session = getAuthSession();
    const investorId = session?.investorId ?? null;
    setSessionInvestorId(investorId);
    if (investorId) setPayerInvestor(investorId);
    if (!investorId) {
      setError("Tu usuario no tiene un inversor asociado. Pedile al admin que lo configure.");
    }

    Promise.all([
      apiFetch<Investor[]>("/investors/"),
      apiFetch<Purchase[]>("/purchases/"),
      apiFetch<Job[]>("/jobs/"),
      apiFetch<PaymentObligation[]>("/payment-obligations/"),
      apiFetch<FxQuote>(`/fx/ars-usd/?date=${date}`),
    ])
      .then(([inv, purch, j, obl, fx]) => {
        setInvestors(inv);
        setPurchases(purch);
        setJobs(j);
        setObligations(obl);
        setFxQuote(fx);
      })
      .catch(() => setError("No se pudo cargar la pantalla"));
  }, [router]);

  useEffect(() => {
    if (!getToken()) return;
    apiFetch<FxQuote>(`/fx/ars-usd/?date=${date}`)
      .then(setFxQuote)
      .catch(() => {});
  }, [date]);

  const amountNumber = Number(amount || 0);
  const trimmedConcept = concept.trim();
  const needsInvestor = !sessionInvestorId || paidBy === "INVESTOR";
  const canSubmit =
    Boolean(trimmedConcept) &&
    amountNumber > 0 &&
    !saving;

  const jobById = useMemo(
    () => Object.fromEntries(jobs.map((j) => [j.id, `${j.client || "Sin cliente"} - ${j.work_type || `Trabajo #${j.id}`}`])),
    [jobs]
  );
  const purchaseById = useMemo(() => Object.fromEntries(purchases.map((p) => [p.id, p.concept])), [purchases]);
  const selectedObligations = useMemo(() => {
    if (purchase) return obligations.filter((o) => o.purchase === purchase);
    return obligations.filter((o) => !o.purchase);
  }, [purchase, obligations]);

  const amountUsd = useMemo(() => {
    if (!fxQuote || !amountNumber) return 0;
    return amountNumber * fxQuote.usd_per_ars;
  }, [amountNumber, fxQuote]);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setOkMessage("");

    if (paidBy === "INVESTOR" && !payerInvestor) {
      setError("Seleccioná qué inversor pagó.");
      return;
    }
    if (!trimmedConcept) {
      setError("Completá el concepto.");
      return;
    }
    if (!amountNumber || amountNumber <= 0) {
      setError("El monto debe ser mayor a cero.");
      return;
    }

    const payload = {
      date,
      concept: trimmedConcept,
      amount,
      currency: "ARS",
      paid_by: paidBy,
      payer_investor: paidBy === "INVESTOR" ? payerInvestor : null,
      purchase: purchase || null,
      job: job || null,
      payment_obligation: paymentObligation || null,
      notes: "Carga rápida móvil",
    };

    setSaving(true);
    try {
      await apiFetch("/expenses/", { method: "POST", body: JSON.stringify(payload) });
      setAmount("");
      setConcept("");
      setPurchase("");
      setJob("");
      setPaymentObligation("");
      setOkMessage("Gasto guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el gasto");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card quick-expense-card" style={{ maxWidth: 480, margin: "0 auto" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ marginBottom: 0 }}>Gasto rápido</h2>
        <Link href="/expenses" className="btn btn-secondary" style={{ padding: "8px 10px" }}>
          Ver gastos
        </Link>
      </div>

      {error ? <p style={{ color: "#b42318", margin: "0 0 10px" }}>{error}</p> : null}
      {okMessage ? <p style={{ color: "#067647", margin: "0 0 10px" }}>{okMessage}</p> : null}

      <form className="form" onSubmit={onSubmit}>

        {/* Campos principales */}
        <div className="ifta-field">
          <input
            id="quick-expense-date"
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <label htmlFor="quick-expense-date">Fecha</label>
        </div>

        <div className="ifta-field">
          <input
            id="quick-expense-concept"
            name="concept"
            placeholder=" "
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            required
          />
          <label htmlFor="quick-expense-concept">Concepto</label>
        </div>

        <div className="qe-amount-wrap">
          <span className="qe-prefix">ARS $</span>
          <input
            id="quick-expense-amount"
            name="amount"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>

        {amountNumber > 0 && fxQuote ? (
          <p className="small" style={{ margin: "-4px 0 0" }}>
            ≈ U$S {formatNumber(amountUsd)} · TC {fxQuote.ars_per_usd.toFixed(2)} ({fxQuote.rate_date})
          </p>
        ) : (
          <p className="small" style={{ margin: "-4px 0 0" }}>
            TC BCRA: {fxQuote ? `${fxQuote.ars_per_usd.toFixed(2)} (${fxQuote.rate_date})` : "cargando..."}
          </p>
        )}

        {!sessionInvestorId ? (
          <div className="ifta-field filled">
            <select
              id="quick-expense-investor"
              name="payer_investor"
              value={payerInvestor}
              onChange={(e) => setPayerInvestor(e.target.value ? Number(e.target.value) : "")}
              required
            >
              <option value="">Seleccionar inversor</option>
              {investors.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.name}
                </option>
              ))}
            </select>
            <label htmlFor="quick-expense-investor">Inversor</label>
          </div>
        ) : null}

        <button className="btn" type="submit" disabled={!canSubmit}>
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
            <div className="ifta-field filled">
              <select
                id="quick-expense-paid-by"
                name="paid_by"
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value as "INVESTOR" | "CASH")}
              >
                <option value="INVESTOR">Paga inversor</option>
                <option value="CASH">Sale de caja</option>
              </select>
              <label htmlFor="quick-expense-paid-by">Origen</label>
            </div>

            {paidBy === "INVESTOR" && sessionInvestorId ? (
              <div className="ifta-field filled">
                <select
                  id="quick-expense-investor-extra"
                  value={payerInvestor}
                  onChange={(e) => setPayerInvestor(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Seleccionar inversor</option>
                  {investors.map((inv) => (
                    <option key={inv.id} value={inv.id}>{inv.name}</option>
                  ))}
                </select>
                <label htmlFor="quick-expense-investor-extra">Inversor</label>
              </div>
            ) : null}

            <div className="ifta-field filled">
              <select
                id="quick-expense-purchase"
                value={purchase}
                onChange={(e) => {
                  setPurchase(e.target.value ? Number(e.target.value) : "");
                  setPaymentObligation("");
                }}
              >
                <option value="">Sin compra asociada</option>
                {purchases.map((p) => (
                  <option key={p.id} value={p.id}>{p.concept}</option>
                ))}
              </select>
              <label htmlFor="quick-expense-purchase">Compra</label>
            </div>

            <div className="ifta-field filled">
              <select
                id="quick-expense-job"
                value={job}
                onChange={(e) => setJob(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Sin trabajo asociado</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{jobById[j.id]}</option>
                ))}
              </select>
              <label htmlFor="quick-expense-job">Trabajo</label>
            </div>

            <div className="ifta-field filled">
              <select
                id="quick-expense-obligation"
                value={paymentObligation}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : "";
                  setPaymentObligation(val);
                  if (!val) return;
                  const obl = obligations.find((o) => o.id === val);
                  if (obl?.purchase) setPurchase(obl.purchase);
                }}
              >
                <option value="">Sin cuenta a pagar asociada</option>
                {selectedObligations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.source === "PURCHASE_INSTALLMENT"
                      ? `Cuota ${o.installment_number}/${o.installment_total} - ${purchaseById[o.purchase || 0] || "Compra"}`
                      : o.concept || `Obligación #${o.id}`}{" "}
                    · {o.due_date}
                  </option>
                ))}
              </select>
              <label htmlFor="quick-expense-obligation">Cuenta a pagar</label>
            </div>
          </>
        ) : null}

      </form>
    </section>
  );
}
