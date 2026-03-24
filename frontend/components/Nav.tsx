"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearToken, getToken } from "@/lib/api";
import { COMPANY_NAME } from "@/lib/brand";

const links: Array<{ href: string; label: string; mobileOnly?: boolean }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/investors", label: "Inversores" },
  { href: "/investments", label: "Compras" },
  { href: "/commitments", label: "Cuentas a pagar" },
  { href: "/expenses", label: "Gastos" },
  { href: "/expenses/quick", label: "Gasto rápido", mobileOnly: true },
  { href: "/works/quick", label: "Trabajo rápido", mobileOnly: true },
  { href: "/works", label: "Trabajos" },
  { href: "/work-participations", label: "Distribuciones" },
  { href: "/reinvestments", label: "Caja" },
  { href: "/conversions", label: "TC" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const syncAuthState = () => setHasToken(Boolean(getToken()));

    setMounted(true);
    syncAuthState();
    const legacyThemeKey = String.fromCharCode(
      114,
      101,
      99,
      97,
      108,
      99,
      97,
      116,
      116,
      105,
      95,
      116,
      104,
      101,
      109,
      101,
    );
    const saved =
      (localStorage.getItem("app_theme") as "light" | "dark" | null) ||
      (localStorage.getItem(legacyThemeKey) as "light" | "dark" | null) ||
      "light";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
    window.addEventListener("authchange", syncAuthState);
    window.addEventListener("storage", syncAuthState);

    return () => {
      window.removeEventListener("authchange", syncAuthState);
      window.removeEventListener("storage", syncAuthState);
    };
  }, []);

  useEffect(() => {
    if (mounted) {
      setHasToken(Boolean(getToken()));
      setMenuOpen(false);
    }
  }, [mounted, pathname]);

  if (!mounted || !hasToken) return null;

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/home" style={{ textDecoration: "none", color: "inherit" }}>
          <strong>{COMPANY_NAME}</strong>
        </Link>
        <div className="nav-right">
          <label className="theme-switch" title="Cambiar tema">
            <input
              type="checkbox"
              checked={theme === "dark"}
              onChange={(event) => {
                const next = event.target.checked ? "dark" : "light";
                setTheme(next);
                localStorage.setItem("app_theme", next);
                document.documentElement.setAttribute("data-theme", next);
              }}
            />
            <span className="theme-slider">
              <span className="theme-knob" />
            </span>
          </label>
          <button
            className="nav-hamburger"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
        <nav className={`nav-links${menuOpen ? " is-open" : ""}`}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${link.mobileOnly ? "nav-link-mobile-only" : ""} ${pathname === link.href ? "active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
          <button
            className="nav-link"
            style={{ border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}
            onClick={() => {
              clearToken();
              setHasToken(false);
              router.push("/login");
            }}
          >
            Salir
          </button>
        </nav>
      </div>
    </header>
  );
}
