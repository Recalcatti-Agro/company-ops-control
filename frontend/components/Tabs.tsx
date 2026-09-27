"use client";

import Link from "next/link";

type Tab = { key: string; label: string; count?: number; href?: string };

// Pestañas de sección. Con `href` navegan entre pantallas hermanas (Compras /
// Vencimientos); sin `href` cambian de vista dentro de la misma pantalla.
export default function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange?: (key: string) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => {
        const cls = `tab${t.key === active ? " active" : ""}`;
        const content = (
          <>
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} className={cls}>{content}</Link>
        ) : (
          <button key={t.key} type="button" className={cls} onClick={() => onChange?.(t.key)}>{content}</button>
        );
      })}
    </div>
  );
}
