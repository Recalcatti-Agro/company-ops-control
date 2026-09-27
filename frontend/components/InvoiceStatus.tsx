import { fmtMoney } from "@/lib/format";

type Inv = {
  status: string;
  currency: string;
  balance_original: string | number;
  collected_usd?: string | number;
  is_overpaid?: boolean;
};

// Estado de una factura. "Cobrada de más" se marca aparte (naranja) para que un
// saldo negativo no pase como si estuviera todo en orden.
export function InvoiceChip({ inv }: { inv: Inv }) {
  if (inv.is_overpaid) return <span className="chip c-partial">Cobrada de más</span>;
  if (inv.status === "OPEN") {
    return Number(inv.collected_usd || 0) > 0
      ? <span className="chip c-partial">Cobro parcial</span>
      : <span className="chip c-open">Por cobrar</span>;
  }
  return <span className="chip c-paid">Cobrada</span>;
}

export function InvoiceBalance({ inv }: { inv: Inv }) {
  if (inv.is_overpaid) {
    return (
      <span className="overdue" title="Se cobró más que el monto facturado">
        {fmtMoney(Math.abs(Number(inv.balance_original)), inv.currency)} de más
      </span>
    );
  }
  return <>{fmtMoney(inv.balance_original, inv.currency)}</>;
}
