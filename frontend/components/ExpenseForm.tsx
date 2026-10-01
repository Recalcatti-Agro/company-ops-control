"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtMoney } from "@/lib/format";

type Option = { id: number; name: string };
type BillOption = {
  id: number; concept: string; due_date: string; amount_original: string; currency: string;
  status: string; paid_amount_original: string;
};
export type ExpenseRecord = {
  id: number; date: string; concept: string; amount_original: string; currency: string;
  fx_ars_usd: string; amount_usd: string; paid_by: string; account: number | null;
  investor: number | null; created_by: number | null; notes?: string; bill?: number | null;
};

function usdFrom(amount: string, currency: string, fx: string) {
  if (!amount) return "";
  if (currency === "USD") return Number(amount).toFixed(2);
  return fx ? (Number(amount) / Number(fx)).toFixed(2) : "";
}

// Alta (expense = null) o edición de un gasto. Guarda solo y avisa con onSaved.
export function ExpenseForm({
  expense,
  accounts,
  investors,
  onSaved,
}: {
  expense: ExpenseRecord | null;
  accounts: Option[];
  investors: Option[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    date: expense?.date || new Date().toISOString().slice(0, 10),
    concept: expense?.concept || "",
    amount_original: expense ? String(Number(expense.amount_original)) : "",
    currency: expense?.currency || "ARS",
    fx_ars_usd: expense?.fx_ars_usd || "",
    paid_by: expense?.paid_by || "CASH",
    account: expense?.account ? String(expense.account) : accounts[0] ? String(accounts[0].id) : "",
    investor: expense?.investor ? String(expense.investor) : "",
    bill: expense?.bill ? String(expense.bill) : "",
  }));
  const [bills, setBills] = useState<BillOption[]>([]);
  const [dateTouched, setDateTouched] = useState(!expense);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // En un alta, o si en la edición se cambia la fecha, se trae el TC de ese día.
  useEffect(() => {
    if (!dateTouched || !form.date) return;
    api.get(`/fx/ars-usd/?date=${form.date}`).then((r) => setForm((f) => ({ ...f, fx_ars_usd: r.ars_per_usd }))).catch(() => {});
  }, [form.date, dateTouched]);

  // Cuotas/cuentas a pagar abiertas (más la ya vinculada, si se edita un gasto que la saldó).
  useEffect(() => {
    api.get("/bills/")
      .then((rows: BillOption[]) => setBills(rows.filter((b) => (b.status !== "PAID" && b.status !== "CANCELLED") || b.id === expense?.bill)))
      .catch(() => {});
  }, [expense?.bill]);

  function pickBill(id: string) {
    const bill = bills.find((b) => String(b.id) === id);
    setForm((f) => {
      if (!bill) return { ...f, bill: "" };
      const remaining = Number(bill.amount_original) - Number(bill.paid_amount_original);
      return {
        ...f,
        bill: id,
        concept: f.concept || bill.concept,
        currency: f.amount_original ? f.currency : bill.currency,
        amount_original: f.amount_original || (remaining > 0 ? remaining.toFixed(2) : ""),
      };
    });
  }

  const amountUsd = usdFrom(form.amount_original, form.currency, form.fx_ars_usd);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload = {
      date: form.date,
      concept: form.concept,
      amount_original: form.amount_original,
      currency: form.currency,
      fx_ars_usd: form.fx_ars_usd,
      amount_usd: amountUsd,
      paid_by: form.paid_by,
      account: form.paid_by === "CASH" ? Number(form.account) : null,
      investor: form.paid_by === "INVESTOR" ? Number(form.investor) : null,
      bill: form.bill ? Number(form.bill) : null,
    };
    try {
      if (expense) await api.patch(`/expenses/${expense.id}/`, payload);
      else await api.post("/expenses/", payload);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "No se pudo guardar el gasto."));
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div>
        <label className="field-label">Fecha</label>
        <input type="date" required value={form.date} onChange={(e) => { setDateTouched(true); setForm({ ...form, date: e.target.value }); }} />
      </div>
      {bills.length > 0 && (
        <div>
          <label className="field-label">Paga una cuota / cuenta a pagar</label>
          <select value={form.bill} onChange={(e) => pickBill(e.target.value)}>
            <option value="">Ninguna</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {fmtDate(b.due_date)} · {b.concept} · {fmtMoney(Number(b.amount_original) - Number(b.paid_amount_original), b.currency)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="field-label">Concepto</label>
        <input required value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} />
      </div>
      <div className="grid grid-2">
        <div>
          <label className="field-label">Monto</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: 90 }}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
            <input type="number" step="0.01" required value={form.amount_original} onChange={(e) => setForm({ ...form, amount_original: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="field-label">Tipo de cambio</label>
          <input type="number" step="0.0001" required value={form.fx_ars_usd} onChange={(e) => setForm({ ...form, fx_ars_usd: e.target.value })} />
        </div>
      </div>
      {form.currency === "ARS" && amountUsd && <div className="small">≈ USD {amountUsd}</div>}
      <div>
        <label className="field-label">Pagado por</label>
        <select value={form.paid_by} onChange={(e) => setForm({ ...form, paid_by: e.target.value })}>
          <option value="CASH">Caja</option>
          <option value="INVESTOR">Inversor</option>
        </select>
      </div>
      {form.paid_by === "CASH" ? (
        <div>
          <label className="field-label">Cuenta</label>
          <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="field-label">Inversor</label>
          <select required value={form.investor} onChange={(e) => setForm({ ...form, investor: e.target.value })}>
            <option value="">Elegir...</option>
            {investors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      )}
      {error && <div className="err">{error}</div>}
      <button className="btn" type="submit" disabled={saving}>{expense ? "Guardar cambios" : "Guardar"}</button>
    </form>
  );
}
