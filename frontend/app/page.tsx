"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function RootPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    const isMobile = window.innerWidth < 640;
    router.replace(isMobile ? "/home" : "/dashboard");
  }, [loading, session, router]);

  return null;
}
