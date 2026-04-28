"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Ambulance, ClipboardList, MapPin, Stethoscope, ArrowLeftRight, BarChart3, LogOut, Building2, CalendarDays, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/intern", label: "Hoje", icon: ClipboardList },
  { href: "/intern/calendario", label: "Calendário", icon: CalendarDays },
  { href: "/intern/checkin", label: "Check-in", icon: MapPin },
  { href: "/intern/bases", label: "Bases", icon: Building2 },
  { href: "/intern/ocorrencias", label: "Ocorrências", icon: Stethoscope },
  { href: "/intern/trocas", label: "Trocas", icon: ArrowLeftRight },
  { href: "/intern/historico", label: "Histórico", icon: BarChart3 },
  { href: "/intern/extras", label: "Extras", icon: Zap },
];

export default function InternLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col pb-24">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2">
          <Ambulance className="h-5 w-5 text-accent-500" strokeWidth={1.5} />
          <h2 className="font-semibold text-slate-900 text-sm">Taxímetro</h2>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/taximetro/login" })}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </header>
      <main className="flex-1 bg-background p-4">{children}</main>
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
