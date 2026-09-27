"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { IconClose } from "@/components/icons";

type Account = { id: number; name: string };
type Investor = { id: number; name: string };

export default function QuickExpensePage() {
  const router = useRouter();
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10), concept: "", amount_original: "",
    currency: "ARS", fx_ars_usd: "", amount_usd: "", paid_by: "CASH", account: "", investor: "",
  });

  useEffect(() => {
    api.get(`/fx/ars-usd/?date=${form.date}`).then((r) => setForm((f) => ({ ...f, fx_ars_usd: r.ars_per_usd })));
    Promise.all([api.get("/accounts/"), api.get("/investors/")]).then(([a, i]) => {
      setAccounts(a);
      setInvestors(i);
      const arsAcc = a.find((x: Account) => true);
      if (arsAcc) setForm((f) => ({ ...f, account: String(arsAcc.id) }));
      const mine = i.find((x: Investor) => x.id === session?.investorId);
      if (mine) setForm((f) => ({ ...f, investor: String(mine.id) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amountUsd = form.amount_original && form.fx_ars_usd ? (Number(form.amount_original) / Number(form.fx_ars_usd)).toFixed(2) : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/expenses/", {
        ...form,
        amount_usd: amountUsd,
        account: form.paid_by === "CASH" ? Number(form.account) : null,
        investor: form.paid_by === "INVESTOR" ? Number(form.investor) : null,
      });
      router.push("/home");
    } catch {
      setError("No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="pageh">
        <h1>Nuevo gasto</h1>
        <button className="btn-ghost" onClick={() => router.back()} type="button" style={{ width: 44, height: 44, borderRadius: 12 }}>
          <IconClose />
        </button>
      </div>

      <form className="form" onSubmit={submit}>
        <div>
          <label className="field-label">Fecha</label>
          <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Concepto</label>
          <input required value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Monto (ARS)</label>
          <input type="number" step="0.01" required value={form.amount_original} onChange={(e) => setForm({ ...form, amount_original: e.target.value })} />
        </div>
        {amountUsd && <div className="small">≈ USD {amountUsd} (TC {form.fx_ars_usd})</div>}
        <div>
          <label className="field-label">Pagado por</label>
          <select value={form.paid_by} onChange={(e) => setForm({ ...form, paid_by: e.target.value })}>
            <option value="CASH">Caja</option>
            <option value="INVESTOR">Yo (inversor)</option>
          </select>
        </div>
        {form.paid_by === "INVESTOR" && (
          <div>
            <label className="field-label">Inversor</label>
            <select required value={form.investor} onChange={(e) => setForm({ ...form, investor: e.target.value })}>
              <option value="">Elegir...</option>
              {investors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}
        {error && <div className="err">{error}</div>}
        <button className="btn" type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar gasto"}</button>
      </form>
    </div>
  );
}
