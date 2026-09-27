"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import Logo from "./Logo";
import {
  IconCash, IconExpenses, IconClients, IconDashboard, IconExchange, IconHome, IconInvestors,
  IconInvoices, IconJobs, IconMore, IconPurchases, IconTheme, IconUsers,
} from "./icons";

type NavItem = { href: string; label: string; icon: () => JSX.Element; also?: string[] };

// Agrupado por flujo: lo que entra (trabajo → factura → cobro), lo que sale y
// dónde está la plata. `also` marca activo el ítem en pantallas hermanas.
const NAV_GROUPS: { section: string; items: NavItem[] }[] = [
  { section: "", items: [{ href: "/dashboard", label: "Inicio", icon: IconDashboard }] },
  {
    section: "Ingresos",
    items: [
      { href: "/jobs", label: "Trabajos", icon: IconJobs },
      { href: "/invoices", label: "Facturación", icon: IconInvoices },
      { href: "/clients", label: "Clientes", icon: IconClients },
    ],
  },
  {
    section: "Egresos",
    items: [
      { href: "/expenses", label: "Gastos", icon: IconExpenses },
      { href: "/purchases", label: "Compras", icon: IconPurchases, also: ["/bills"] },
    ],
  },
  {
    section: "Dinero",
    items: [
      { href: "/cash", label: "Caja", icon: IconCash },
      { href: "/investors", label: "Inversores", icon: IconInvestors },
    ],
  },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/users", label: "Usuarios", icon: IconUsers },
  { href: "/exchange-rates", label: "Tipos de cambio", icon: IconExchange },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [userMenu, setUserMenu] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem("rc_theme") as "light" | "dark") || "light";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("rc_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  if (!session) return null;
  const isAdmin = session.role === "ADMIN";
  const groups = isAdmin ? [...NAV_GROUPS, { section: "Administración", items: ADMIN_ITEMS }] : NAV_GROUPS;
  const isActive = (item: NavItem) => [item.href, ...(item.also || [])].some((h) => pathname?.startsWith(h));

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-header">
          <Logo />
        </div>
        <div className="nav">
          {groups.map((group) => (
            <div key={group.section || "top"} style={{ display: "contents" }}>
              {group.section && <div className="nav-section">{group.section}</div>}
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} className={`nav-item${isActive(item) ? " active" : ""}`}>
                  <item.icon />
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
          <div className="nav-item" onClick={toggleTheme} style={{ marginTop: 8 }}>
            <IconTheme />
            {theme === "light" ? "Tema oscuro" : "Tema claro"}
          </div>
        </div>
        {/* El clic abre un menú: antes un clic en el nombre cerraba la sesión sin aviso. */}
        <div style={{ marginTop: "auto", position: "relative" }}>
          {userMenu && (
            <div className="user-menu">
              <button type="button" onClick={logout}>Cerrar sesión</button>
            </div>
          )}
          <div className="user-chip" onClick={() => setUserMenu((v) => !v)}>
            <div className="avatar">{session.username.slice(0, 2).toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{session.username}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{isAdmin ? "Administrador" : "Inversor"}</div>
            </div>
            <span className="small">{userMenu ? "▾" : "▴"}</span>
          </div>
        </div>
      </div>

      <div className="bottom-nav">
        <Link href="/home" className={pathname === "/home" ? "active" : ""}><IconHome />Inicio</Link>
        <Link href="/jobs" className={pathname?.startsWith("/jobs") ? "active" : ""}><IconJobs />Trabajos</Link>
        <Link href="/expenses" className={pathname?.startsWith("/expenses") ? "active" : ""}><IconExpenses />Gastos</Link>
        <Link href="/more" className={pathname === "/more" ? "active" : ""}><IconMore />Más</Link>
      </div>
    </>
  );
}
