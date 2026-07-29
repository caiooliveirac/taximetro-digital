"use client";

import Link from "next/link";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Ambulance, Camera, ClipboardList, MapPin, Stethoscope, ArrowLeftRight, BarChart3, LogOut, Building2, CalendarDays, CalendarX, Zap, Shield, Users, type LucideIcon } from "lucide-react";
import { temFeature } from "@/lib/instance";
import { InternPhotoChangeModal } from "@/components/intern-photo-change-modal";
import { extractRoleNames, pickReturnRole, type ManagementRole } from "@/lib/role-access-policy";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/intern", label: "Hoje", icon: ClipboardList },
  { href: "/intern/calendario", label: "Calendário", icon: CalendarDays },
  { href: "/intern/checkin", label: "Check-in", icon: MapPin },
  // Indisponibilidade só existe na Vitalmed — ver src/lib/instance.ts.
  ...(temFeature("internUnavailability")
    ? [{ href: "/intern/indisponibilidade", label: "Indisponibilidade", icon: CalendarX }]
    : []),
  { href: "/intern/bases", label: "Bases", icon: Building2 },
  { href: "/intern/ocorrencias", label: "Ocorrências", icon: Stethoscope },
  { href: "/intern/trocas", label: "Trocas", icon: ArrowLeftRight },
  { href: "/intern/historico", label: "Histórico", icon: BarChart3 },
  { href: "/intern/extras", label: "Extras", icon: Zap },
];

const RETURN_AREA_META: Record<ManagementRole, { href: string; label: string; icon: LucideIcon }> = {
  COORDINATOR: { href: "/admin", label: "Admin", icon: Shield },
  LEADER: { href: "/leader", label: "Líder", icon: Users },
  PRECEPTOR: { href: "/preceptor", label: "Preceptor", icon: Stethoscope },
};

export default function InternLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [photoModalOpen, setPhotoModalOpen] = useState(false);

  const returnRole = pickReturnRole(extractRoleNames(session?.user?.roles, session?.user?.role));
  const returnArea = returnRole ? RETURN_AREA_META[returnRole] : null;

  return (
    <div className="flex min-h-screen flex-col pb-24">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2">
          <Ambulance className="h-5 w-5 text-accent-500" strokeWidth={1.5} />
          <h2 className="font-semibold text-slate-900 text-sm">Taxímetro</h2>
        </div>
        <div className="flex items-center gap-2">
          {returnArea && (
            <Link
              href={returnArea.href}
              className="inline-flex items-center gap-1.5 rounded-full bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-navy-700"
            >
              <returnArea.icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {returnArea.label}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setPhotoModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <Camera className="h-4 w-4" strokeWidth={1.5} />
            <span>Foto</span>
          </button>
          <button
            onClick={() => signOut({ callbackUrl: "/taximetro/login" })}
            className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </header>
      <main className="flex-1 bg-background p-4">{children}</main>
      <InternPhotoChangeModal open={photoModalOpen} onClose={() => setPhotoModalOpen(false)} />
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 shadow-[0_-1px_3px_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto grid max-w-lg grid-cols-8 px-1 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] pt-2">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/intern" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 px-1 text-center text-[9px] font-medium leading-tight transition-colors",
                  active ? "text-accent-600" : "text-slate-400"
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.5} />
                <span className="block max-w-full truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
