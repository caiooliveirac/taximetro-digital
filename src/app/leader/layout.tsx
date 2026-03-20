"use client";

import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import {
  LayoutDashboard,
  Calendar,
  UserRound,
  ClipboardList,
  BarChart3,
  Settings2,
} from "lucide-react";

const NAV: NavItem[] = [
  { href: "/leader", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leader/escala", label: "Escala", icon: Calendar },
  { href: "/leader/internos", label: "Internos", icon: UserRound },
  { href: "/leader/solicitacoes", label: "Solicitações", icon: ClipboardList },
  { href: "/leader/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/leader/calibrar", label: "Calibrar", icon: Settings2 },
];

export default function LeaderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar
        nav={NAV}
        role="Líder de Escala"
        navGroups={[
          { label: "Operação", items: NAV.slice(0, 3) },
          { label: "Gestão", items: NAV.slice(3) },
        ]}
      />
      <main className="flex-1 p-4 lg:p-6 pb-20 lg:pb-6">{children}</main>
    </div>
  );
}
