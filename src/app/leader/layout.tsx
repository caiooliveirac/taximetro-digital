"use client";

import Link from "next/link";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import {
  LayoutDashboard,
  Calendar,
  UserRound,
  XCircle,
  ClipboardList,
  BarChart3,
  Settings2,
  ArrowRightLeft,
  Zap,
  Ambulance,
  GraduationCap,
} from "lucide-react";

const NAV: NavItem[] = [
  { href: "/leader", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leader/escala", label: "Escala", icon: Calendar },
  { href: "/leader/remanejamento", label: "Remanejamento", icon: ArrowRightLeft },
  { href: "/leader/internos", label: "Internos", icon: UserRound },
  { href: "/leader/faltas", label: "Faltas", icon: XCircle },
  { href: "/leader/solicitacoes", label: "Solicitações", icon: ClipboardList },
  { href: "/leader/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/leader/calibrar", label: "Calibrar", icon: Settings2 },
  { href: "/leader/extras", label: "Extras", icon: Zap },
];

export default function LeaderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar
        nav={NAV}
        role="Líder de Escala"
        navGroups={[
          { label: "Operação", items: NAV.slice(0, 5) },
             { label: "Gestão", items: NAV.slice(5, 8) },
             { label: "Extras", items: NAV.slice(8) },
        ]}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header mobile: alterna para a visão de interno (check-in do próprio plantão) */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] lg:hidden">
          <div className="flex items-center gap-2">
            <Ambulance className="h-5 w-5 text-accent-500" strokeWidth={1.5} />
            <h2 className="font-semibold text-slate-900 text-sm">Taxímetro</h2>
          </div>
          <Link
            href="/intern"
            className="inline-flex items-center gap-1.5 rounded-full bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-navy-700"
          >
            <GraduationCap className="h-3.5 w-3.5" strokeWidth={1.8} />
            Interno
          </Link>
        </header>
        <main className="flex-1 p-4 lg:p-6 pb-20 lg:pb-6">{children}</main>
      </div>
    </div>
  );
}
