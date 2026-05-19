"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { ImpersonateProvider } from "@/components/impersonate/impersonate-provider";
import { ImpersonateBanner } from "@/components/impersonate/impersonate-banner";

const STALE_RELOAD_KEY = "__taximetro_stale_reload_at";
const STALE_RELOAD_COOLDOWN_MS = 60_000;

function isStaleBundleMessage(message: unknown) {
  const text = typeof message === "string" ? message : (message as Error | undefined)?.message ?? "";
  return (
    /ChunkLoadError/.test(text) ||
    /Loading chunk [\w-]+ failed/i.test(text) ||
    /Loading CSS chunk/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text) ||
    /router state header/i.test(text)
  );
}

function reloadOnceIfStale(source: unknown) {
  if (!isStaleBundleMessage(source)) return;
  try {
    const last = Number(sessionStorage.getItem(STALE_RELOAD_KEY) ?? "0");
    if (Date.now() - last < STALE_RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()));
  } catch {
    // sem sessionStorage — segue o reload
  }
  window.location.reload();
}

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reloadOnceIfStale(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reloadOnceIfStale(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <SessionProvider basePath="/taximetro/api/auth">
      <ImpersonateProvider>
        <ImpersonateBanner />
        {children}
      </ImpersonateProvider>
    </SessionProvider>
  );
}
