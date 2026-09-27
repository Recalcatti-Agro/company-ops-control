export function fmtARS(value: number | string) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return "$ " + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export function fmtUSD(value: number | string) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return "USD " + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export function fmtMoney(amountOriginal: number | string, currency: string) {
  return currency === "ARS" ? fmtARS(amountOriginal) : fmtUSD(amountOriginal);
}

export function fmtPct(value: number | string) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n.toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "%";
}

export function fmtDate(value: string) {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

const JOB_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  DONE: "Realizado",
  INVOICED: "Facturado",
  COLLECTED: "Cobrado",
  CANCELLED: "Cancelado",
};

export function jobStatusLabel(status: string) {
  return JOB_STATUS_LABEL[status] || status;
}

export function fmtDateFull(value: string) {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

export const JOB_STATUS_CHIP: Record<string, string> = {
  PENDING: "c-pending",
  DONE: "c-teal",
  INVOICED: "c-open",
  COLLECTED: "c-paid",
  CANCELLED: "c-cancel",
};

export function fmtHa(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("es-AR", { maximumFractionDigits: 2 }) + " ha";
}

// Días corridos desde una fecha ISO (yyyy-mm-dd) hasta hoy.
export function daysSince(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - then) / 86400000);
}

// Suma montos por moneda sin convertir y los muestra juntos ("$ 1.000 + USD 50").
export function sumByCurrency(items: { amount: string | number; currency: string }[]) {
  const totals: Record<string, number> = {};
  for (const it of items) totals[it.currency] = (totals[it.currency] || 0) + Number(it.amount || 0);
  const parts = Object.entries(totals).filter(([, v]) => v !== 0).map(([cur, v]) => fmtMoney(v, cur));
  return parts.length ? parts.join(" + ") : "—";
}

// "septiembre de 2026" → "Septiembre de 2026" (text-transform: capitalize pondría "De").
export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Cliente comodín que creó la migración para trabajos sin cliente identificado.
// No hay un campo que lo marque: se reconoce por el nombre (que es único).
export const PLACEHOLDER_CLIENT = "Sin cliente / a confirmar";
export const isPlaceholderClient = (name: string) => name === PLACEHOLDER_CLIENT;

// "hace 3 meses" / "hace 12 días" a partir de una fecha ISO.
export function timeAgo(value: string) {
  const days = daysSince(value);
  if (days < 0) return `en ${-days} d`;
  if (days === 0) return "hoy";
  if (days < 30) return `hace ${days} d`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12);
  return `hace ${years} ${years === 1 ? "año" : "años"}`;
}
