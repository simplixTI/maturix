"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";

let validated = false;

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("maturador_token");

    if (!token) {
      router.replace("/login");
      return;
    }

    // Already validated this session - skip API call
    if (validated) {
      setReady(true);
      return;
    }

    // Validate once per session
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (!res.ok) {
          localStorage.removeItem("maturador_token");
          localStorage.removeItem("maturador_user");
          router.replace("/login");
        } else {
          validated = true;
          setReady(true);
        }
      })
      .catch(() => {
        // Backend down - allow with cached token
        validated = true;
        setReady(true);
      });
  }, [router]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="font-mono text-xs text-muted-foreground animate-pulse">loading...</div>
      </div>
    );
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
