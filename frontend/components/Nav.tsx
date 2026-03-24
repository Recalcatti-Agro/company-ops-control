"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearToken, getToken } from "@/lib/api";
import { COMPANY_NAME } from "@/lib/brand";

type NavLink = { href: string; label: string; desktopOnly?: boolean };
type NavSection = { section: string; links: NavLink[] };

const navSections: NavSection[] = [
  {
    section: "",
    links: [
      { href: "/dashboard", label: "Home", desktopOnly: true },
      { href: "/home", label: "Home", desktopOnly: false },
    ],
  },
  {
    section: "Operaciones",
    links: [
      { href: "/expenses", label: "Gastos" },
      { href: "/works", label: "Trabajos" },
      { href: "/work-participations", label: "Distribuciones" },
    ],
  },
  {
    section: "Finanzas",
    links: [
      { href: "/reinvestments", label: "Caja" },
      { href: "/investments", label: "Compras" },
      { href: "/commitments", label: "Cuentas a pagar" },
      { href: "/conversions", label: "TC" },
    ],
  },
  {
    section: "Análisis",
    links: [
      { href: "/investors", label: "Inversores" },
    ],
  },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const syncAuthState = () => setHasToken(Boolean(getToken()));

    setMounted(true);
    syncAuthState();
    setIsMobile(window.matchMedia("(max-width: 640px)").matches);
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
    <>
      <button
        className="sidebar-toggle"
        aria-label="Abrir menú"
        onClick={() => setMenuOpen(true)}
      >
        ☰
      </button>

      <button
        className="mobile-theme-btn"
        title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          setTheme(next);
          localStorage.setItem("app_theme", next);
          document.documentElement.setAttribute("data-theme", next);
        }}
      >
        {theme === "dark" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      {menuOpen && (
        <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} />
      )}

      <aside className={`sidebar${menuOpen ? " is-open" : ""}`}>
        <div className="sidebar-header">
          <Link href={isMobile ? "/home" : "/dashboard"} className="sidebar-brand" aria-label={COMPANY_NAME} onClick={() => setMenuOpen(false)}>
            <Image
              src="/logo-light.png"
              alt={COMPANY_NAME}
              width={1480}
              height={297}
              className="sidebar-logo sidebar-logo-light"
              priority
            />
            <Image
              src="/logo-dark.png"
              alt={COMPANY_NAME}
              width={1480}
              height={297}
              className="sidebar-logo sidebar-logo-dark"
              priority
            />
          </Link>
          <button className="sidebar-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}>
            ✕
          </button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((group) => (
            <div key={group.section} className="sidebar-section">
              {group.section ? <span className="sidebar-section-label">{group.section}</span> : null}
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`sidebar-link${link.desktopOnly === true ? " sidebar-link-desktop-only" : ""}${link.desktopOnly === false ? " sidebar-link-mobile-only" : ""}${pathname === link.href ? " active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="theme-btn"
            title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              localStorage.setItem("app_theme", next);
              document.documentElement.setAttribute("data-theme", next);
            }}
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            className="sidebar-logout"
            onClick={() => {
              clearToken();
              setHasToken(false);
              router.push("/login");
            }}
          >
            Salir
          </button>
        </div>
      </aside>
    </>
  );
}
