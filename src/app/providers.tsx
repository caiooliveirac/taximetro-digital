"use client";

import { SessionProvider } from "next-auth/react";
import { ImpersonateProvider } from "@/components/impersonate/impersonate-provider";
import { ImpersonateBanner } from "@/components/impersonate/impersonate-banner";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/taximetro/api/auth">
      <ImpersonateProvider>
        <ImpersonateBanner />
        {children}
      </ImpersonateProvider>
    </SessionProvider>
  );
}
