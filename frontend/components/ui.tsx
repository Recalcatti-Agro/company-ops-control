"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Piezas de layout compartidas por todas las pantallas. Si una pantalla necesita
// algo parecido, extender estas en vez de volver a armarlo con estilos inline.

type Crumb = { href: string; label: string };

// Encabezado de pantalla: breadcrumb opcional, título (+ chip al lado), subtítulo y acciones a la derecha.
export function PageHeader({
  title, sub, crumbs, badge, actions,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  crumbs?: Crumb[];
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <>
      {crumbs && crumbs.length > 0 && (
        <div className="sub breadcrumb">
          {crumbs.map((c) => (
            <span key={c.href}><Link href={c.href}>{c.label}</Link> / </span>
          ))}
          <b>{title}</b>
        </div>
      )}
      <div className="pageh">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1>{title}</h1>
            {badge}
          </div>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </>
  );
}

// Tarjeta de KPI. Con `href` es clickeable; `tone="warn"` la pinta de ámbar (requiere atención).
export function Kpi({
  label, value, sub, href, tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: "warn";
}) {
  const content = (
    <>
      <div className="kpi-label">{label}</div>
      <div className={`kpi${tone === "warn" ? " overdue" : ""}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  );
  const cls = `card${href ? " kpi-link" : ""}${tone === "warn" ? " card-warn" : ""}`;
  return href ? <Link href={href} className={cls}>{content}</Link> : <div className={cls}>{content}</div>;
}

// Dato etiquetado de una ficha (label chico arriba, valor abajo).
export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field-caption">{label}</div>
      <div className="field-value">{value || "—"}</div>
    </div>
  );
}

// Buscador con lupa, para la primera posición de un FilterBar.
export function SearchInput({ value, onChange, placeholder = "Buscar..." }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search-input">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// Filtro de período: atajos habituales y "Personalizado" (recién ahí aparecen las fechas).
// Trabaja con fechas ISO (yyyy-mm-dd); "" = sin límite.
const PERIODS: { key: string; label: string; range?: () => [string, string] }[] = [
  { key: "", label: "Período: todo" },
  { key: "this-month", label: "Este mes", range: () => [monthStart(0), monthEnd(0)] },
  { key: "last-month", label: "Mes pasado", range: () => [monthStart(-1), monthEnd(-1)] },
  { key: "last-3", label: "Últimos 3 meses", range: () => [monthStart(-2), monthEnd(0)] },
  { key: "this-year", label: "Este año", range: () => [`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`] },
  { key: "last-year", label: "Año pasado", range: () => [`${new Date().getFullYear() - 1}-01-01`, `${new Date().getFullYear() - 1}-12-31`] },
  { key: "custom", label: "Personalizado…" },
];

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthStart(offset: number) {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth() + offset, 1));
}
function monthEnd(offset: number) {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0));
}

export function PeriodFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  // Qué atajo coincide con el rango actual; si no coincide ninguno pero hay fechas, es personalizado.
  const matched = PERIODS.find((p) => p.range && p.range()[0] === from && p.range()[1] === to)?.key;
  const [custom, setCustom] = useState(false);
  const current = custom ? "custom" : matched ?? (from || to ? "custom" : "");

  // Si desde afuera se limpian los filtros, se sale del modo personalizado.
  useEffect(() => { if (!from && !to) setCustom(false); }, [from, to]);

  function pick(key: string) {
    const p = PERIODS.find((x) => x.key === key);
    if (key === "custom") { setCustom(true); return; }
    setCustom(false);
    const [f, t] = p?.range ? p.range() : ["", ""];
    onChange(f, t);
  }

  return (
    <>
      <select value={current} onChange={(e) => pick(e.target.value)}>
        {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      {current === "custom" && (
        <span className="date-range">
          <label>Desde <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
          <label>Hasta <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
        </span>
      )}
    </>
  );
}

// Fila de filtros con "Limpiar filtros" cuando hay alguno activo.
export function FilterBar({ active, onClear, children }: { active: boolean; onClear: () => void; children: React.ReactNode }) {
  return (
    <div className="row filter-bar">
      {children}
      {active && <button type="button" className="btn-ghost" onClick={onClear}>Limpiar filtros</button>}
    </div>
  );
}

// Encabezado de una tarjeta: título a la izquierda, dato o acción a la derecha.
export function CardHead({ title, aside, className }: { title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className="card-head">
      <h2 className={className}>{title}</h2>
      {aside && <div className="small">{aside}</div>}
    </div>
  );
}

// Barra de progreso (participación, cuotas pagadas).
export function ProgressBar({ pct, height = 8 }: { pct: number; height?: number }) {
  return (
    <div className="bar" style={{ height }}>
      <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
