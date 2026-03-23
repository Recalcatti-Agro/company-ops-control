"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, getAuthSession, getToken } from "@/lib/api";

type Investor = { id: number; name: string };
type FxQuote = {
  requested_date: string;
  rate_date: string;
  ars_per_usd: number;
  usd_per_ars: number;
  source: string;
};

export default function QuickExpensePage() {
  const router = useRouter();
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [paidBy, setPaidBy] = useState<"INVESTOR" | "CASH">("INVESTOR");
  const [payerInvestor, setPayerInvestor] = useState<number | "">("");
  const [fxQuote, setFxQuote] = useState<FxQuote | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [sessionInvestorId, setSessionInvestorId] = useState<number | null>(null);
  const [sessionUsername, setSessionUsername] = useState<string>("");

  const loadFxQuote = async (targetDate: string) => {
    const quote = await apiFetch<FxQuote>(`/fx/ars-usd/?date=${targetDate}`);
    setFxQuote(quote);
  };

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }

    const session = getAuthSession();
    setSessionInvestorId(session?.investorId ?? null);
    setSessionUsername(session?.user?.username ?? "");

    Promise.all([apiFetch<Investor[]>("/investors/"), loadFxQuote(date)])
      .then(([investorsData]) => setInvestors(investorsData))
      .catch(() => setError("No se pudo cargar la pantalla rápida"));
  }, [router]);

  useEffect(() => {
    if (!investors.length || paidBy !== "INVESTOR") return;
    if (payerInvestor) return;

    if (sessionInvestorId && investors.some((i) => i.id === sessionInvestorId)) {
      setPayerInvestor(sessionInvestorId);
      return;
    }

    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");

    const u = normalize(sessionUsername);
    if (!u) return;
    const matched = investors.find((inv) => {
      const n = normalize(inv.name);
      return n === u || n.includes(u) || u.includes(n);
    });
    if (matched) setPayerInvestor(matched.id);
  }, [investors, paidBy, payerInvestor, sessionInvestorId, sessionUsername]);

  useEffect(() => {
    if (!getToken()) return;
    loadFxQuote(date).catch(() => setError("No se pudo obtener tipo de cambio"));
  }, [date]);

  const amountNumber = Number(amount || 0);
  const amountUsd = useMemo(() => {
    if (!fxQuote) return 0;
    return currency === "ARS" ? amountNumber * fxQuote.usd_per_ars : amountNumber;
  }, [currency, amountNumber, fxQuote]);
  const amountArs = useMemo(() => {
    if (!fxQuote) return 0;
    return currency === "USD" ? amountNumber * fxQuote.ars_per_usd : amountNumber;
  }, [currency, amountNumber, fxQuote]);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const resetForm = () => {
    setConcept("");
    setAmount("");
    setCurrency("ARS");
    setPaidBy("INVESTOR");
    setPayerInvestor("");
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setOkMessage("");

    if (paidBy === "INVESTOR" && !payerInvestor) {
      setError("Seleccioná qué inversor pagó.");
      return;
    }

    if (!amountNumber || amountNumber <= 0) {
      setError("El monto debe ser mayor a cero.");
      return;
    }

    const payload = {
      date,
      concept: concept.trim(),
      amount,
      currency,
      paid_by: paidBy,
      payer_investor: paidBy === "INVESTOR" ? payerInvestor : null,
      purchase: null,
      job: null,
      payment_obligation: null,
      notes: "Carga rápida móvil",
    };

    setSaving(true);
    try {
      await apiFetch("/expenses/", { method: "POST", body: JSON.stringify(payload) });
      resetForm();
      setOkMessage("Gasto guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el gasto");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card quick-expense-card" style={{ maxWidth: 560, margin: "0 auto" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ marginBottom: 0 }}>Gasto rápido</h2>
        <Link href="/expenses" className="btn btn-secondary" style={{ padding: "8px 10px" }}>
          Ver gastos
        </Link>
      </div>
      <p className="small" style={{ marginTop: 0 }}>
        Pantalla simplificada para cargar un gasto desde celular en pocos segundos.
      </p>

      {error ? <p style={{ color: "#b42318", margin: "0 0 10px" }}>{error}</p> : null}
      {okMessage ? <p style={{ color: "#067647", margin: "0 0 10px" }}>{okMessage}</p> : null}

      <form className="form" onSubmit={onSubmit}>
        <div className="quick-expense-row">
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

          <div className="ifta-field">
            <input
              id="quick-expense-amount"
              name="amount"
              inputMode="decimal"
              placeholder=" "
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <label htmlFor="quick-expense-amount">Monto</label>
          </div>

          <div className="ifta-field filled">
            <select
              id="quick-expense-currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as "ARS" | "USD")}
            >
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
            <label htmlFor="quick-expense-currency">Moneda</label>
          </div>

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

          {paidBy === "INVESTOR" ? (
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
        </div>

        <div className="quick-expense-kpis">
          <div className="card" style={{ padding: 10, borderRadius: 12 }}>
            <div className="small">ARS</div>
            <div style={{ fontWeight: 700 }}>{`$${formatNumber(amountArs)}`}</div>
          </div>
          <div className="card" style={{ padding: 10, borderRadius: 12 }}>
            <div className="small">USD</div>
            <div style={{ fontWeight: 700 }}>{`U$S ${formatNumber(amountUsd)}`}</div>
          </div>
        </div>

        <div className="small">
          TC BCRA: {fxQuote ? `${fxQuote.ars_per_usd.toFixed(2)} (${fxQuote.rate_date})` : "cargando..."}
        </div>

        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Guardando..." : "Guardar gasto"}
        </button>
      </form>
    </section>
  );
}
