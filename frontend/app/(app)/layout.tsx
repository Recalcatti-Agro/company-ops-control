"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Nav from "@/components/Nav";
import Logo from "@/components/Logo";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session) return null;

  return (
    <>
      <Nav />
      <div className="container">
        <div className="mobile-topbar">
          <Logo height={24} />
        </div>
        {children}
      </div>
    </>
  );
}
