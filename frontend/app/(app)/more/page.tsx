"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
  IconClients, IconDashboard, IconExchange, IconInvestors, IconInvoices, IconPurchases, IconUsers,
} from "@/components/icons";

export default function MorePage() {
  const { session, logout } = useAuth();
  const items = [
    { href: "/dashboard", label: "Inicio", icon: IconDashboard },
    { href: "/clients", label: "Clientes", icon: IconClients },
    { href: "/invoices", label: "Facturación", icon: IconInvoices },
    { href: "/purchases", label: "Compras", icon: IconPurchases },
    { href: "/investors", label: "Inversores", icon: IconInvestors },
    ...(session?.role === "ADMIN" ? [
      { href: "/users", label: "Usuarios", icon: IconUsers },
      { href: "/exchange-rates", label: "Tipos de cambio", icon: IconExchange },
    ] : []),
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 20 }}>Más</h1>
      <div className="card" style={{ padding: 8 }}>
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="nav-item" style={{ padding: "12px 10px" }}>
            <item.icon />
            {item.label}
          </Link>
        ))}
        <div className="nav-item" onClick={logout} style={{ padding: "12px 10px" }}>
          Cerrar sesión
        </div>
      </div>
    </div>
  );
}
