"use client";

import { useEffect, useRef, useState } from "react";

export type MonthPoint = { month: string; a: number; b: number };

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 58 };

function fmtShort(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e6) return "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " M";
  if (abs >= 1e3) return "$ " + Math.round(n / 1e3).toLocaleString("es-AR") + " k";
  return "$ " + Math.round(n).toLocaleString("es-AR");
}
const fmtFull = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
const monthLabel = (m: string, opts: Intl.DateTimeFormatOptions) => new Date(m + "-02").toLocaleDateString("es-AR", opts);

// Barras agrupadas por mes: dos series (ej. cobrado vs gastos) en una sola escala.
export default function MonthlyChart({ data, labelA, labelB }: { data: MonthPoint[]; labelA: string; labelB: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  // Escala "redonda" para que las líneas de grilla caigan en valores legibles.
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => max / s <= 4) || magnitude * 10;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const colW = data.length ? plotW / data.length : 0;
  const barW = Math.max(4, Math.min(22, (colW - 10) / 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  // Barra con esquinas redondeadas solo arriba, apoyada en la línea base.
  function bar(x: number, v: number) {
    const h = Math.max(0, (v / top) * plotH);
    if (h === 0) return "";
    const r = Math.min(4, h, barW / 2);
    const y0 = PAD.top + plotH;
    return `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + barW - r} Q${x + barW},${y0 - h} ${x + barW},${y0 - h + r} V${y0} Z`;
  }

  const hovered = hover !== null ? data[hover] : null;

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={`${labelA} y ${labelB} por mes`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{fmtShort(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + colW * i + colW / 2;
            return (
              <g key={d.month}>
                {hover === i && <rect x={cx - colW / 2 + 2} y={PAD.top} width={colW - 4} height={plotH} rx={6} fill="var(--hover-bg)" />}
                <path d={bar(cx - barW - 1, d.a)} fill="var(--series-1)" />
                <path d={bar(cx + 1, d.b)} fill="var(--series-2)" />
                <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" style={{ textTransform: "capitalize" }}>
                  {monthLabel(d.month, { month: "short" }).replace(".", "")}
                </text>
                {/* Zona de hover: toda la columna, más grande que las barras. */}
                <rect x={cx - colW / 2} y={PAD.top} width={colW} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {hovered && hover !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(Math.max(PAD.left + colW * hover + colW / 2 - 90, 0), Math.max(0, width - 190)),
            top: 0,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4, textTransform: "capitalize" }}>{monthLabel(hovered.month, { month: "long", year: "numeric" })}</div>
          <Line color="var(--series-1)" label={labelA} value={fmtFull(hovered.a)} />
          <Line color="var(--series-2)" label={labelB} value={fmtFull(hovered.b)} />
          <div style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4, display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span className="small">Diferencia</span>
            <b>{fmtFull(hovered.a - hovered.b)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function Line({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span><span className="legend-swatch" style={{ background: color }} />{label}</span>
      <b>{value}</b>
    </div>
  );
}
